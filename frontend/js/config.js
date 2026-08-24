const API_BASE_URL = (() => {
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (isLocal) return "http://localhost:3000";
  return "";
})();
