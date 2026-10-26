(() => {
  const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";
  const container = document.querySelector("#google-signin");
  const buttonSlot = document.querySelector("#google-signin-button");
  const message = document.querySelector("#google-signin-message");

  function loadGsiScript() {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GSI_SCRIPT_URL;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Não foi possível carregar o login do Google"));
      document.head.append(script);
    });
  }

  async function handleCredential(response) {
    message.textContent = "Entrando...";
    try {
      const result = await AuthRepository.signInWithGoogle(response.credential);
      localStorage.setItem("loreroutine:token", result.token);
      localStorage.setItem("loreroutine:userName", result.user.name);
      location.href = "index.html";
    } catch (error) {
      message.textContent = error.message;
    }
  }

  async function init() {
    const { clientId } = await AuthRepository.getGoogleConfig();
    if (!clientId) return;
    await loadGsiScript();
    google.accounts.id.initialize({ client_id: clientId, callback: handleCredential });
    google.accounts.id.renderButton(buttonSlot, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      locale: "pt-BR",
      width: Math.min(buttonSlot.clientWidth || 348, 400),
    });
    container.hidden = false;
  }

  init().catch((error) => console.warn(error));
})();
