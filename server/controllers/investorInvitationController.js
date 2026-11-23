'use strict';

const service = require('../services/investorInvitationService');

function fail(res, err) {
  const status = Number(err?.statusCode) || (err?.code === 'sign_in_required' ? 409 : 400);
  return res.status(status).json({ error: err?.code === 'sign_in_required' ? err.message : service.GENERIC_FAILURE, code: err?.code || 'investor_invitation_invalid' });
}
exports.create = async (req, res) => {
  try {
    const invitation = await service.createInvitation({ email: req.body?.email, createdBy: req.user.id, expiresAt: req.body?.expiresAt });
    return res.status(201).json({ invitation });
  } catch (err) { return fail(res, err); }
};
exports.revoke = async (req, res) => {
  try { return res.json({ invitation: await service.revokeInvitation({ id: req.params.id, adminId: req.user.id }) }); }
  catch (err) { return fail(res, err); }
};

exports.verify = async (req, res) => {
  try { return res.json(await service.verifyInvitation({ id: req.body?.id, email: req.body?.email, inviteCode: req.body?.inviteCode || req.body?.code })); }
  catch (err) { return fail(res, err); }
};

exports.accept = async (req, res) => {
  try {
    const result = await service.acceptInvitation({ email: req.body?.email, proof: req.body?.proof, verificationCode: req.body?.verificationCode || req.body?.code, userId: req.user?.id, account: req.body, request: req });
    return res.status(result.created ? 201 : 200).json({ status: 'pending_review', admissionId: result.admission.id, created: result.created });
  } catch (err) { return fail(res, err); }
};
