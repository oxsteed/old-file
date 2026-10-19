'use strict';

// Record projections for the governed metric cohorts. Only fixed identifiers
// and bound filter values reach SQL; contact details and payment credentials
// are deliberately absent from analytics evidence.
const { majorUnitScaleSql } = require('./financialMetrics');
const { paidOrderPredicate } = require('./restaurantAnalytics');

function metricEvidenceSql(query, scope, registry, summary) {
  const params = [registry.PERIOD_INTERVAL[query.period].interval];
  let text, columns;
  const window = alias => `${alias}.created_at>=NOW()-$1::interval`;
  switch (query.metric) {
    case 'platform_revenue_cents':
      text = `SELECT id AS ledger_id,job_id,source_type,UPPER(currency) AS currency_code,amount_cents,created_at
        FROM platform_ledger l WHERE source_type IN ('job_fee','subscription') AND amount_cents>0 AND ${window('l')} ORDER BY created_at DESC,id`;
      columns = ['ledger_id','job_id','source_type','currency_code','amount_cents','created_at']; break;
    case 'investor_gmv_cents':
    case 'investor_take_rate_pct':
      text = `SELECT j.id AS job_id,UPPER(j.currency_code) AS currency_code,j.final_price_cents AS gmv_cents,
        (SELECT COALESCE(SUM(l.amount_cents),0)::bigint FROM platform_ledger l WHERE l.job_id=j.id
          AND UPPER(l.currency)=UPPER(j.currency_code) AND l.source_type='job_fee' AND l.amount_cents>0) AS fee_cents
        FROM jobs j WHERE j.status='completed' AND j.deleted_at IS NULL
          ${query.metric==='investor_take_rate_pct'?'AND j.final_price_cents IS NOT NULL':''} ORDER BY j.id`;
      columns = ['job_id','currency_code','gmv_cents','fee_cents']; params.length=0; break;
    case 'mrr_cents':
      text = `SELECT s.id AS subscription_id,UPPER(p.currency) AS currency_code,p.amount_cents,p.interval AS billing_interval,
        CASE p.interval WHEN 'year' THEN p.amount_cents/12.0 ELSE p.amount_cents END AS monthly_minor_units
        FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.status='active' ORDER BY s.id`;
      columns = ['subscription_id','currency_code','amount_cents','billing_interval','monthly_minor_units']; params.length=0; break;
    case 'escrow_held_cents':
      text = `SELECT id AS payment_id,UPPER(currency) AS currency_code,status,escrow_status,
        GREATEST(COALESCE(capture_amount_cents,ROUND(amount*${majorUnitScaleSql('currency')})::bigint,0)
          -COALESCE(ROUND(refunded_amount*${majorUnitScaleSql('currency')})::bigint,0),0)::bigint AS escrow_held_cents
        FROM payments WHERE escrow_status IN ('held','disputed') AND status IN ('authorized','captured') ORDER BY id`;
      columns = ['payment_id','currency_code','status','escrow_status','escrow_held_cents']; params.length=0; break;
    case 'open_disputes':
      text = "SELECT id AS dispute_id,job_id,status FROM disputes WHERE status='open' ORDER BY id";
      columns=['dispute_id','job_id','status']; params.length=0; break;
    case 'cancel_rate_pct':
    case 'dispute_rate_pct': {
      let cohort='TRUE';
      if (query.metric==='cancel_rate_pct' && query.filters.customerId) { params.push(query.filters.customerId);cohort='j.client_id=$2::uuid'; }
      else if (query.filters.role==='customer') cohort='j.client_id IS NOT NULL';
      else if (query.filters.role==='helper') cohort='j.assigned_helper_id IS NOT NULL';
      text = `SELECT j.id AS job_id,j.status,j.client_id IS NOT NULL AS customer_cohort,
        j.assigned_helper_id IS NOT NULL AS helper_cohort,
        EXISTS(SELECT 1 FROM disputes d WHERE d.job_id=j.id) AS disputed,j.created_at
        FROM jobs j WHERE j.deleted_at IS NULL AND ${window('j')} AND ${cohort}
          ${query.metric==='dispute_rate_pct'?'AND j.created_at<NOW()':''} ORDER BY j.created_at DESC,j.id`;
      columns=['job_id','status','customer_cohort','helper_cohort','disputed','created_at']; break;
    }
    case 'job_completion_rate_pct':
      text=`SELECT j.id AS job_id,j.status,j.created_at FROM jobs j
        WHERE j.deleted_at IS NULL AND j.status IN ('completed','cancelled') AND ${window('j')} AND j.created_at<NOW()
        ORDER BY j.created_at DESC,j.id`;
      columns=['job_id','status','created_at']; break;
    case 'refund_rate_pct':
      text=`SELECT id AS payment_id,status,COALESCE(refunded_amount,0) AS refunded_major_units,UPPER(currency) AS currency_code,created_at
        FROM payments p WHERE status IN ('captured','released','refunded') AND ${window('p')} AND created_at<NOW() ORDER BY created_at DESC,id`;
      columns=['payment_id','status','refunded_major_units','currency_code','created_at']; break;
    case 'payout_failure_count':
      text=`SELECT id AS payout_id,status,currency_code,amount_cents,created_at FROM main_app_payout_requests p
        WHERE status='failed' AND ${window('p')} AND created_at<NOW() ORDER BY created_at DESC,id`;
      columns=['payout_id','status','currency_code','amount_cents','created_at']; break;
    case 'sla_first_response_compliance_pct': {
      const target=registry.slaFirstResponseTargetSql('sc','sla_tgt');
      if (query.filters.businessId!=null) params.push(query.filters.businessId);
      text=`SELECT sc.id AS conversation_id,sc.business_id,sc.priority,sc.first_response_at,${target} AS target_at,
        (sc.first_response_at IS NOT NULL AND sc.first_response_at<=${target}) AS met,sc.created_at
        FROM support_conversations sc ${registry.slaTargetsJoinSql('sc','sla_tgt')}
        WHERE sc.status<>'merged' AND ${window('sc')}
          AND (sc.first_response_at IS NOT NULL OR NOW()>${target})
          ${params.length>1?'AND sc.business_id=$2::integer':''} ORDER BY sc.created_at DESC,sc.id`;
      columns=['conversation_id','business_id','priority','first_response_at','target_at','met','created_at']; break;
    }
    case 'support_nps_index':
      if(query.filters.businessId!=null) params.push(query.filters.businessId);
      text=`SELECT scr.id AS review_id,scr.conversation_id,sc.business_id,scr.nps_score,scr.created_at
        FROM support_conversation_reviews scr JOIN support_conversations sc ON sc.id=scr.conversation_id
        WHERE scr.nps_score IS NOT NULL AND ${window('scr')} ${params.length>1?'AND sc.business_id=$2::integer':''} ORDER BY scr.created_at DESC,scr.id`;
      columns=['review_id','conversation_id','business_id','nps_score','created_at']; break;
    case 'consulting_avg_nps':
      text=`SELECT id AS feedback_id,nps_score,created_at FROM consulting_session_feedback f
        WHERE nps_score IS NOT NULL AND ${window('f')} ORDER BY created_at DESC,id`;
      columns=['feedback_id','nps_score','created_at']; break;
    case 'consulting_cancel_rate_pct':
      text=`SELECT id AS session_id,status,created_at FROM consulting_sessions s
        WHERE status IN ('completed','cancelled') AND ${window('s')} ORDER BY created_at DESC,id`;
      columns=['session_id','status','created_at']; break;
    case 'restaurant_repeat_order_rate':
    case 'restaurant_top_items_revenue': {
      const allowed=(scope.restaurantIds||[]).map(String), id=query.filters.restaurantId;
      // The builder validates the same scope before this projection runs.
      if(id!=null) params.push([String(id)]);
      else if(!scope.isSuperAdmin) params.push(allowed);
      const filter=params.length>1?'AND fo.restaurant_id=ANY($2::bigint[])':'';
      const base=`FROM food_orders fo WHERE ${paidOrderPredicate()} AND ${window('fo')} ${filter}`;
      if(query.metric==='restaurant_repeat_order_rate') {
        text=`SELECT fo.id AS order_id,fo.restaurant_id,fo.customer_id,
          COUNT(*) OVER(PARTITION BY restaurant_id,customer_id)::int AS customer_orders,fo.created_at
          ${base} AND fo.customer_id IS NOT NULL ORDER BY fo.created_at DESC,fo.id`;
        columns=['order_id','restaurant_id','customer_id','customer_orders','created_at'];
      } else {
        // Reuse the actual top-ten selection, including its currency ranks.
        // Its parameter layout may be a single id or an id array.
        params.splice(0,params.length,...summary.params);
        const summaryFilter = id!=null ? 'AND fo.restaurant_id=$2::bigint'
          : !scope.isSuperAdmin ? 'AND fo.restaurant_id=ANY($2::bigint[])' : '';
        text=`WITH top_items AS (${summary.text}), paid AS (
          SELECT fo.* FROM food_orders fo WHERE ${paidOrderPredicate()}
          AND fo.created_at>=NOW()-$1::interval ${summaryFilter}
        ) SELECT fo.id AS order_id,fo.restaurant_id,
          foi.menu_item_id,foi.item_name,foi.quantity,foi.line_total_cents AS revenue_cents,UPPER(fo.currency_code) AS currency_code,fo.created_at
          FROM paid fo JOIN food_order_items foi ON foi.order_id=fo.id
          JOIN top_items ti ON ti.restaurant_id=fo.restaurant_id
            AND ti.item_key=COALESCE(foi.menu_item_id::text,'name:'||foi.item_name)
            AND ti.currency_code=UPPER(fo.currency_code)
          ORDER BY fo.created_at DESC,fo.id,foi.id`;
        columns=['order_id','restaurant_id','menu_item_id','item_name','quantity','revenue_cents','currency_code','created_at'];
      }
      break;
    }
    default: throw new Error('No evidence projection for this metric');
  }
  return { text,params,columns };
}
module.exports={ metricEvidenceSql };
