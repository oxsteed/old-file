'use strict';

const pool = require('../db');

const AUTHORIZED_RESTAURANTS_SQL = `
  SELECT DISTINCT ON (fr.id)
         fr.id AS restaurant_id,
         fr.business_id,
         COALESCE(fr.display_name, b.business_name) AS restaurant_name,
         b.business_name,
         CASE
           WHEN b.user_id = $1 OR fr.owner_user_id = $1 THEN 'owner'
           ELSE bm.role
         END AS role,
         bm.id AS membership_id,
         uwc.last_selected_at,
         uwc.restaurant_id AS selected_restaurant_id
    FROM food_restaurants fr
    JOIN businesses b ON b.id = fr.business_id
    LEFT JOIN business_members bm
      ON bm.business_id = fr.business_id
     AND bm.member_id = $1
     AND bm.status = 'active'
    LEFT JOIN user_workspace_contexts uwc
      ON uwc.user_id = $1
     AND uwc.business_id = fr.business_id
   WHERE (b.user_id = $1 OR fr.owner_user_id = $1 OR bm.id IS NOT NULL)
     AND b.is_active != FALSE
     AND b.deleted_at IS NULL
     AND fr.status = 'active'
   ORDER BY fr.id, uwc.last_selected_at DESC NULLS LAST
`;

async function loadWorkspaces(userId) {
  const { rows } = await pool.query(AUTHORIZED_RESTAURANTS_SQL, [userId]);
  return rows.map((row) => ({
    restaurant_id: row.restaurant_id,
    business_id: row.business_id,
    restaurant_name: row.restaurant_name,
    business_name: row.business_name,
    role: row.role,
    membership_id: row.membership_id,
    last_selected_at: row.last_selected_at,
    is_selected: Number(row.selected_restaurant_id) === Number(row.restaurant_id),
  }));
}

exports.listWorkspaces = async (req, res, next) => {
  try {
    const workspaces = await loadWorkspaces(req.user.id);
    const selected = workspaces.find((workspace) => workspace.is_selected)
      || workspaces
      .filter((workspace) => workspace.last_selected_at)
      .sort((a, b) => new Date(b.last_selected_at) - new Date(a.last_selected_at))[0]
      || workspaces[0]
      || null;

    res.json({
      workspaces,
      selected_restaurant_id: selected?.restaurant_id || null,
    });
  } catch (err) {
    next(err);
  }
};

exports.getUnifiedInbox = async (req, res, next) => {
  try {
    const workspaces = await loadWorkspaces(req.user.id);
    const restaurantIds = workspaces.map((workspace) => workspace.restaurant_id);
    if (restaurantIds.length === 0) {
      return res.json({ workspaces: [], offers: [], assignments: [] });
    }

    const [{ rows: offers }, { rows: assignments }] = await Promise.all([
      pool.query(
        `SELECT t.*,
                w.business_id,
                w.restaurant_name,
                w.business_name,
                o.guest_name AS customer_name,
                o.fulfillment_type,
                o.total_cents,
                o.tip_cents,
                o.metadata AS order_metadata
           FROM restaurant_runner_tasks t
           JOIN (VALUES ${restaurantIds.map((_, index) => `($${index + 2}::bigint)`).join(',')}) authorized(restaurant_id)
             ON authorized.restaurant_id = t.restaurant_id
           JOIN food_restaurants fr ON fr.id = t.restaurant_id
           JOIN businesses b ON b.id = fr.business_id
           CROSS JOIN LATERAL (
             SELECT fr.business_id,
                    COALESCE(fr.display_name, b.business_name) AS restaurant_name,
                    b.business_name
           ) w
           LEFT JOIN food_orders o ON o.id = t.food_order_id
          WHERE t.assigned_to IS NULL
            AND t.status IN ('Queued','Ready')
            AND (t.offer_expires_at IS NULL OR t.offer_expires_at > NOW())
            AND NOT EXISTS (
              SELECT 1
                FROM restaurant_runner_task_declines d
               WHERE d.task_id = t.id AND d.runner_user_id = $1
            )
          ORDER BY CASE WHEN t.status = 'Ready' THEN 0 ELSE 1 END,
                   COALESCE(t.delivery_eta_at, t.created_at) ASC
          LIMIT 200`,
        [req.user.id, ...restaurantIds]
      ),
      pool.query(
        `SELECT t.*,
                fr.business_id,
                COALESCE(fr.display_name, b.business_name) AS restaurant_name,
                b.business_name,
                o.guest_name AS customer_name,
                o.fulfillment_type,
                o.total_cents,
                o.tip_cents,
                o.metadata AS order_metadata
           FROM restaurant_runner_tasks t
           JOIN (VALUES ${restaurantIds.map((_, index) => `($${index + 2}::bigint)`).join(',')}) authorized(restaurant_id)
             ON authorized.restaurant_id = t.restaurant_id
           JOIN food_restaurants fr ON fr.id = t.restaurant_id
           JOIN businesses b ON b.id = fr.business_id
           LEFT JOIN food_orders o ON o.id = t.food_order_id
          WHERE t.assigned_to = $1
          ORDER BY CASE t.status
                     WHEN 'Ready' THEN 0
                     WHEN 'Assigned' THEN 1
                     WHEN 'Picked up' THEN 2
                     WHEN 'En route' THEN 3
                     WHEN 'Issue' THEN 4
                     WHEN 'Completed' THEN 5
                     ELSE 6
                   END,
                   t.created_at DESC
          LIMIT 300`,
        [req.user.id, ...restaurantIds]
      ),
    ]);

    res.json({ workspaces, offers, assignments });
  } catch (err) {
    next(err);
  }
};

exports._test = { loadWorkspaces, AUTHORIZED_RESTAURANTS_SQL };
