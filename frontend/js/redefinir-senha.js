const form = document.querySelector("#reset-form");
const message = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const token = new URLSearchParams(location.search).get("token");

// Tira o token da barra de endereço (histórico) assim que a página abre.
history.replaceState(null, "", location.pathname);

if (!token) {
  message.innerHTML = 'Link inválido. <a href="esqueci-senha.html">Peça um novo link</a>.';
  submitButton.disabled = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (form.newPassword.value !== form.confirmPassword.value) {
    message.textContent = "As senhas não coincidem.";
    return;
  }
  submitButton.disabled = true;
  message.textContent = "Salvando...";

  try {
    await AuthRepository.resetPassword({ token, newPassword: form.newPassword.value });
    form.reset();
    message.innerHTML = 'Senha alterada! <a href="login.html">Entrar agora</a>.';
  } catch (error) {
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});
