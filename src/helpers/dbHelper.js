// Uma função simples para padronizar updates auditados
exports.updateWithAudit = (Model, id, data, req) => {
  return Model.findByIdAndUpdate(id, data, {
    new: true,
    user: req.user ? req.user._id : null, // Pega o user automático do req
    reason: req.body.reason || null       // Pega o motivo automático do req
  });
};