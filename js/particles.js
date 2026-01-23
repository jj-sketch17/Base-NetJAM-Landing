particlesJS("particles-js", {
  "particles": {
    "number": { "value": 100, "density": { "enable": true, "value_area": 800 } },
    "color": { "value": "#00C2FF" },
    "shape": { "type": "circle" },
    "opacity": { "value": 0.5 },
    "size": { "value": 3, "random": true }, // Nodos pequeños
    "line_linked": {
      "enable": true,
      "distance": 150,
      "color": "#00C2FF",
      "opacity": 0.4,
      "width": 1
    },
    "move": { "enable": true, "speed": 2 }
  },
  "interactivity": {
    "events": { "onhover": { "enable": true, "mode": "grab" } }
  }
});