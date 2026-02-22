import "./styles.css";

function renderPlaceholder() {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) {
    throw new Error("#app element not found");
  }

  root.innerHTML = `
    <main class="shell">
      <section class="panel">
        <h1>Nosis Desktop Wrapper</h1>
        <p>
          This desktop target is configured to wrap the web app runtime.
        </p>
      </section>
    </main>
  `;
}

renderPlaceholder();
