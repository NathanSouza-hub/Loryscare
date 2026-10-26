const form = document.querySelector("#forgot-form");
const message = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  message.textContent = "Enviando...";

  try {
    await AuthRepository.requestPasswordReset(form.email.value);
    message.textContent = "Se este e-mail estiver cadastrado, você vai receber um link em instantes. Confira também a caixa de spam.";
  } catch (error) {
    message.textContent = error.message;
    submitButton.disabled = false;
  }
});
