const { OAuth2Client } = require("google-auth-library");

function createGoogleIdTokenVerifier(clientId = process.env.GOOGLE_CLIENT_ID) {
  const client = new OAuth2Client();
  return async function verifyGoogleIdToken(idToken) {
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID não configurado");
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    return ticket.getPayload();
  };
}

module.exports = createGoogleIdTokenVerifier;
