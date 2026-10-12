const initialHash = window.location.hash;
const isReload = performance.getEntriesByType("navigation")[0]?.type === "reload";
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.addEventListener("pageshow", () => {
  if (!isReload) return;
  const smoother = window.ScrollSmoother?.get();
  if (smoother) smoother.scrollTo(0, false);
  else window.scrollTo(0, 0);
}, { once: true });
if (initialHash) {
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function initGlobe() {
const THREE = window.THREE;
if (!THREE) return;

const canvas = document.querySelector("#globe");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.z = 6.5;

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);

const globe = new THREE.Group();
globe.scale.setScalar(0.72);
scene.add(globe);

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.67, 64, 64),
  new THREE.MeshPhysicalMaterial({ color: 0x26301b, roughness: 0.82, metalness: 0.08, transparent: true, opacity: 0.93 })
);
globe.add(sphere);

const wireMaterial = new THREE.MeshBasicMaterial({ color: 0xcafa50, wireframe: true, transparent: true, opacity: 0.15 });
const wireGlobe = new THREE.Mesh(new THREE.SphereGeometry(1.682, 32, 24), wireMaterial);
globe.add(wireGlobe);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.75, 48, 48),
  new THREE.MeshBasicMaterial({ color: 0xcafa50, transparent: true, opacity: 0.045, side: THREE.BackSide })
);
globe.add(atmosphere);

const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0xe7ff88 });
const nodePositions = [
  [-0.18, 1.22, 1.05], [0.72, 0.83, 1.25], [1.35, 0.16, 0.94],
  [0.93, -0.7, 1.19], [-0.7, -0.35, 1.53], [-1.25, 0.46, 0.99],
];

for (const position of nodePositions) {
  const node = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), nodeMaterial);
  node.position.set(...position).normalize().multiplyScalar(1.704);
  globe.add(node);
}

const singapore = new THREE.Vector3(0.78, -0.32, 1.46).normalize().multiplyScalar(1.71);
const singaporeMarker = new THREE.Group();
const markerCore = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 16), new THREE.MeshBasicMaterial({ color: 0xd5fa4f }));
singaporeMarker.add(markerCore);
const markerHalo = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.09, 32), new THREE.MeshBasicMaterial({ color: 0xd5fa4f, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
markerHalo.lookAt(singapore.clone().multiplyScalar(2));
singaporeMarker.position.copy(singapore);
globe.add(singaporeMarker, markerHalo);
markerHalo.position.copy(singapore).multiplyScalar(1.025);

const routeMaterial = new THREE.LineBasicMaterial({ color: 0xd5fa4f, transparent: true, opacity: 0.54 });
const packetMaterial = new THREE.MeshBasicMaterial({ color: 0xf3ffd1 });
const routes = [];
for (const [index, point] of nodePositions.slice(1, 5).entries()) {
  const target = new THREE.Vector3(...point).normalize().multiplyScalar(1.71);
  const middle = singapore.clone().add(target).multiplyScalar(0.5).normalize().multiplyScalar(2.1);
  const curve = new THREE.QuadraticBezierCurve3(singapore, middle, target);
  globe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(42)), routeMaterial));
  const packet = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 10), packetMaterial);
  globe.add(packet);
  routes.push({ curve, packet, offset: index / 4 });
}

const dustPositions = new Float32Array(150 * 3);
for (let index = 0; index < dustPositions.length; index += 3) {
  const height = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = 2 + Math.random() * 0.55;
  const horizontal = Math.sqrt(1 - height * height) * radius;
  dustPositions[index] = Math.cos(angle) * horizontal;
  dustPositions[index + 1] = height * radius;
  dustPositions[index + 2] = Math.sin(angle) * horizontal;
}
const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute("position", new THREE.Float32BufferAttribute(dustPositions, 3));
const networkDust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xd5fa4f, size: 0.018, transparent: true, opacity: 0.55, sizeAttenuation: true }));
scene.add(networkDust);

scene.add(new THREE.AmbientLight(0xffffff, 2.1));
const keyLight = new THREE.PointLight(0xd5fa4f, 9, 12);
keyLight.position.set(-3, 2.5, 4);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x8ba94a, 6, 12);
rimLight.position.set(3, -2, -2);
scene.add(rimLight);

const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

let dragging = false;
let lastPointer = { x: 0, y: 0 };

function resize() {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  renderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / bounds.height;
  camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvas);
window.addEventListener("pointermove", (event) => {
  if (dragging) return;
  pointer.targetX = (event.clientX / window.innerWidth - 0.5) * 0.25;
  pointer.targetY = (event.clientY / window.innerHeight - 0.5) * 0.16;
}, { passive: true });
canvas.addEventListener("pointerdown", (event) => {
  dragging = true;
  lastPointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  pointer.targetX += (event.clientX - lastPointer.x) * 0.008;
  pointer.targetY += (event.clientY - lastPointer.y) * 0.008;
  pointer.targetX = THREE.MathUtils.clamp(pointer.targetX, -Math.PI, Math.PI);
  pointer.targetY = THREE.MathUtils.clamp(pointer.targetY, -1.1, 1.1);
  lastPointer = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("pointercancel", () => { dragging = false; });

let frame = 0;
let lastRender=0;
let globeVisible=true;
new IntersectionObserver(entries=>{globeVisible=entries[0].isIntersecting;},{rootMargin:'120px'}).observe(canvas);
function render(time=0) {
  requestAnimationFrame(render);
  if(document.hidden || !globeVisible || time-lastRender<32) return;
  const delta=Math.min((time-lastRender)/16.667,3);lastRender=time;
  frame += prefersReducedMotion?0:delta;
  pointer.x += (pointer.targetX - pointer.x) * 0.035;
  pointer.y += (pointer.targetY - pointer.y) * 0.035;
  globe.rotation.y = pointer.x + (!dragging && !prefersReducedMotion ? frame * 0.0014 : 0);
  globe.rotation.x = -pointer.y - 0.12;
  if (!prefersReducedMotion) {
    networkDust.rotation.y += 0.00035;
    markerHalo.scale.setScalar(1 + (Math.sin(frame * 0.045) + 1) * 0.18);
    markerHalo.material.opacity = 0.3 + (Math.sin(frame * 0.045) + 1) * 0.25;
  }
  for (const route of routes) {
    route.packet.position.copy(route.curve.getPointAt((frame * 0.002 + route.offset) % 1));
  }
  renderer.render(scene, camera);
}
resize();
render();
}
try { initGlobe(); } catch { /* CSS globe remains visible when WebGL is unavailable. */ }

if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

if (!prefersReducedMotion && window.gsap && window.ScrollTrigger) {
  gsap.utils.toArray('.reveal').forEach(elem => {
    gsap.fromTo(elem, 
      { y: 40, opacity: 0 }, 
      { 
        y: 0, 
        opacity: 1, 
        duration: 1, 
        ease: "power3.out", 
        scrollTrigger: {
          trigger: elem,
          start: "top 85%",
          toggleActions: "play none none reverse"
        }
      }
    );
  });

  gsap.to(".image-bg", {
    scale: 1.15,
    ease: "none",
    scrollTrigger: {
      trigger: ".network-image",
      start: "top bottom",
      end: "bottom top",
      scrub: true
    }
  });
}

// Local fallback keeps entrance transitions working when the CDN is unavailable.
if (!prefersReducedMotion && !(window.gsap && window.ScrollTrigger) && 'IntersectionObserver' in window) {
  const entrances = new WeakMap();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entrances.get(entry.target)?.cancel();
        entrances.set(entry.target, entry.target.animate([
          { opacity: 0, transform: 'translateY(40px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 1000, easing: 'cubic-bezier(.16,1,.3,1)' }));
      }
    }
  }, { threshold: .05 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
}

// Horizontal cards use native scrolling as a fallback and on touch devices.
if (window.gsap && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);
  gsap.matchMedia().add('(min-width: 901px) and (min-height: 650px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',()=>{
    const stage=document.querySelector('.features-stage');
    const viewport=document.querySelector('.features-viewport');
    const track=document.querySelector('.features-track');
    if(!stage || !viewport || !track)return;
    const distance=()=>Math.max(0,track.scrollWidth-viewport.clientWidth);
    stage.classList.add('features-pinned');
    viewport.scrollLeft=0;
    const tween=gsap.to(track,{x:()=>-distance(),ease:'none',scrollTrigger:{
      trigger:stage,start:'top top',end:()=>'+='+Math.max(600,distance()),
      pin:true,scrub:.65,invalidateOnRefresh:true,anticipatePin:1
    }});
    const onKey=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const trigger=tween.scrollTrigger;
      const step=viewport.clientWidth*.65/Math.max(1,distance());
      const position=event.key==='Home'?0:event.key==='End'?1:Math.max(0,Math.min(1,trigger.progress+(event.key==='ArrowRight'?step:-step)));
      window.scrollTo({top:trigger.start+position*(trigger.end-trigger.start),behavior:'smooth'});
    };
    viewport.addEventListener('keydown',onKey);
    const refresh=()=>ScrollTrigger.refresh();
    document.fonts?.ready.then(()=>{if(stage.classList.contains('features-pinned'))refresh();});
    return ()=>{
      viewport.removeEventListener('keydown',onKey);
      tween.scrollTrigger?.kill();tween.kill();
      gsap.set(track,{clearProps:'transform'});
      stage.classList.remove('features-pinned');
    };
  });
}

const progress = document.querySelector(".scroll-progress");
const progressFill = document.querySelector(".scroll-progress-track i");
const progressValue = document.querySelector(".scroll-progress-value");
let progressFrame = 0;
function updateScrollProgress() {
  const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
  const scrollPosition = window.ScrollSmoother?.get()?.scrollTop() ?? window.scrollY;
  const percentage = scrollableHeight > 0 ? Math.round((scrollPosition / scrollableHeight) * 100) : 0;
  progressFill.style.transform = `scaleY(${percentage / 100})`;
  progressValue.textContent = `${String(percentage).padStart(2, "0")}%`;
  progress.setAttribute("aria-valuenow", String(percentage));
  progressFrame = 0;
}
window.addEventListener("scroll", () => {
  if (!progressFrame) progressFrame = requestAnimationFrame(updateScrollProgress);
}, { passive: true });
window.addEventListener("resize", updateScrollProgress, { passive: true });
updateScrollProgress();

const customCursor = document.querySelector(".custom-cursor");
const cursorLabel = customCursor.querySelector(".cursor-ring span");
if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.body.classList.add("has-custom-cursor");
  window.addEventListener("pointermove", (event) => {
    customCursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
  }, { passive: true });
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest("a, button, summary, #globe");
    customCursor.classList.toggle("is-active", Boolean(target));
    cursorLabel.textContent = target?.id === "globe" ? "DRAG" : "OPEN";
  });
  document.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget?.closest("a, button, summary, #globe")) {
      customCursor.classList.remove("is-active");
    }
  });
}

function scrollToHashTarget(target, smooth = true) {
  const animate = smooth && !prefersReducedMotion;
  const smoother = window.ScrollSmoother?.get();
  if (smoother) {
    smoother.scrollTo(target, animate);
  } else {
    target.scrollIntoView({ behavior: animate ? "smooth" : "auto", block: "start" });
  }
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest('a[href^="#"]');
  if (!anchor || anchor.target === "_blank") return;
  const target = document.getElementById(decodeURIComponent(anchor.hash.slice(1)));
  if (!target) return;

  event.preventDefault();
  history.pushState(null, "", anchor.hash);
  scrollToHashTarget(target);
});

window.addEventListener("popstate", () => {
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1))) || document.getElementById("home");
  if (target) scrollToHashTarget(target);
});

if (initialHash) {
  const initialTarget = document.getElementById(decodeURIComponent(initialHash.slice(1)));
  if (initialTarget) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${initialHash}`);
    scrollToHashTarget(initialTarget, false);
    window.addEventListener("load", () => {
      requestAnimationFrame(() => window.ScrollTrigger?.refresh());
    }, { once: true });
  }
}

