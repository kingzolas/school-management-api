const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

function createResponseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

test('legacy auth middleware rejects guardian token on staff/student routes', async () => {
  const originalSecret = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = 'legacy-secret';

    delete require.cache[require.resolve('../../api/middlewares/auth.middleware')];
    const { verifyToken } = require('../../api/middlewares/auth.middleware');

    const token = jwt.sign(
      {
        sub: 'guardian-account-1',
        school_id: 'school-1',
        tutorId: 'tutor-1',
        principalType: 'guardian',
        tokenType: 'guardian_auth',
      },
      process.env.JWT_SECRET
    );

    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };
    const res = createResponseRecorder();
    let nextCalled = false;

    verifyToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.message, 'Token nao autorizado neste fluxo.');
  } finally {
    process.env.JWT_SECRET = originalSecret;
  }
});
