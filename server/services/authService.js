const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { verifyToken };
