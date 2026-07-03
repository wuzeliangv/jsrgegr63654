/**
 * Express async route handler wrapper.
 * Catches rejected promises and forwards errors to Express error middleware.
 * Usage: router.post('/path', asyncHandler(async (req, res) => { ... }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
