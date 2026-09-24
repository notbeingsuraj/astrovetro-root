document.addEventListener("DOMContentLoaded", () => {
  const menuButton = document.getElementById("menuBtn");
  const siteNav = document.getElementById("siteNav");

  if (menuButton && siteNav) {
    menuButton.addEventListener("click", () => {
      siteNav.classList.toggle("mobile-open");
    });

    siteNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        siteNav.classList.remove("mobile-open");
      });
    });
  }

  document.querySelector(".js-newsletter-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    alert("Thank you — you are subscribed.");
    event.currentTarget.reset();
  });

  document.querySelector(".js-contact-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    alert("Thank you — your message has been received.");
    event.currentTarget.reset();
  });
});
