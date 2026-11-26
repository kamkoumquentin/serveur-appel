document.addEventListener("DOMContentLoaded", () => {
  const acceptBtn = document.getElementById("swipeAcceptBtn");
  let startY = 0;
  let currentY = 0;
  let isDragging = false;
  const threshold = -80; // Distance en pixels à parcourir vers le haut pour déclencher le clic

  // --- 1. Gestion des vibrations ---
  function demarrerVibration() {
    if (!acceptBtn) return;
    acceptBtn.classList.add("vibrating");

    // Vibration physique du téléphone (sur mobile)
    if ("vibrate" in navigator) {
      navigator.vibrate([200, 100, 200, 100, 200, 800]);
    }
  }

  function arreterVibration() {
    if (!acceptBtn) return;
    acceptBtn.classList.remove("vibrating");

    if ("vibrate" in navigator) {
      navigator.vibrate(0);
    }
  }

  // Lancer la vibration au chargement
  demarrerVibration();

  // --- 2. Action au clic (Événement onclick) ---
  if (acceptBtn) {
    acceptBtn.onclick = function (e) {
      arreterVibration();
      console.log("Événement ONCLICK déclenché !");

      // Exécutez votre logique ici (ex: changer d'écran)
      if (typeof switchInterface === "function") {
        const premierBouton = document.querySelector(".switch-btn");
        switchInterface(1, { currentTarget: premierBouton });
      }
    };
  }

  // --- 3. Gestion du Swipe (Glissement) ---
  function startDrag(y) {
    isDragging = true;
    startY = y;
    arreterVibration();
    if (acceptBtn) {
      acceptBtn.style.transition = "none";
    }
  }

  function moveDrag(y) {
    if (!isDragging || !acceptBtn) return;
    currentY = y - startY;

    // Limiter le déplacement visuel du bouton
    if (currentY > 10) currentY = 10;
    if (currentY < -150) currentY = -150;

    acceptBtn.style.transform = `translateY(${currentY}px)`;
  }

  function endDrag() {
    if (!isDragging || !acceptBtn) return;
    isDragging = false;
    acceptBtn.style.transition = "transform 0.3s ease";

    // Si le swipe dépasse le seuil (-80px vers le haut)
    if (currentY <= threshold) {
      acceptBtn.style.transform = `translateY(0px)`;

      // Déclenche explicitement le gestionnaire onclick
      if (typeof acceptBtn.onclick === "function") {
        acceptBtn.onclick(acceptCall());
      } else {
        acceptBtn.click();
      }
    } else {
      // Rétablissement du bouton si le swipe n'a pas été assez haut
      acceptBtn.style.transform = `translateY(0px)`;
      demarrerVibration();
    }
    currentY = 0;
  }

  // Écouteurs pour Smart-phones (Tactile)
  if (acceptBtn) {
    acceptBtn.addEventListener(
      "touchstart",
      (e) => startDrag(e.touches[0].clientY),
      { passive: true },
    );
    window.addEventListener(
      "touchmove",
      (e) => {
        if (isDragging) moveDrag(e.touches[0].clientY);
      },
      { passive: true },
    );
    window.addEventListener("touchend", endDrag);

    // Écouteurs pour Ordinateur (Souris)
    acceptBtn.addEventListener("mousedown", (e) => startDrag(e.clientY));
    window.addEventListener("mousemove", (e) => {
      if (isDragging) moveDrag(e.clientY);
    });
    window.addEventListener("mouseup", endDrag);
  }
});
