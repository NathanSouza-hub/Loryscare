const LiveUpdates = (() => {
  function connect(onEvent) {
    const token = AuthContext.getToken();
    if (!token) return null;
    const source = new EventSource(`${API_BASE_URL}/api/stream?token=${encodeURIComponent(token)}`);
    source.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data));
      } catch (error) {
        // mensagem não é um evento válido; ignora
      }
    };
    return source;
  }

  return Object.freeze({ connect });
})();
