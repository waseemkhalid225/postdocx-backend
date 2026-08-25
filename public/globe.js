/* ForiForeign 3D globe — fully procedural (Three.js r128 + GSAP via free CDN).
   No paid services, no external assets: sphere, grid, dots, arcs, aircraft,
   particles and glow are all generated in code. Exposes window.FFGlobe. */
(function () {
  const REGIONS = {
    pk:     { color: 0xffffff },
    europe: { color: 0x4f8ef7 },
    uk:     { color: 0x8b5cf6 },
    na:     { color: 0x22c55e },
    aus:    { color: 0xf59e0b },
    gulf:   { color: 0xf97316 },
    asia:   { color: 0xec4899 }
  };
  const COUNTRIES = [
    { code: 'PK', name: 'Pakistan', lat: 33.7, lng: 73.1, region: 'pk' },
    { code: 'GB', name: 'United Kingdom', lat: 52.5, lng: -1.5, region: 'uk' },
    { code: 'IE', name: 'Ireland', lat: 53.2, lng: -7.7, region: 'uk' },
    { code: 'DE', name: 'Germany', lat: 51.0, lng: 10.0, region: 'europe' },
    { code: 'FR', name: 'France', lat: 46.5, lng: 2.5, region: 'europe' },
    { code: 'IT', name: 'Italy', lat: 42.5, lng: 12.5, region: 'europe' },
    { code: 'ES', name: 'Spain', lat: 40.2, lng: -3.5, region: 'europe' },
    { code: 'NL', name: 'Netherlands', lat: 52.2, lng: 5.3, region: 'europe' },
    { code: 'SE', name: 'Sweden', lat: 60.0, lng: 15.0, region: 'europe' },
    { code: 'NO', name: 'Norway', lat: 61.0, lng: 8.5, region: 'europe' },
    { code: 'FI', name: 'Finland', lat: 62.0, lng: 26.0, region: 'europe' },
    { code: 'US', name: 'United States', lat: 39.5, lng: -98.0, region: 'na' },
    { code: 'CA', name: 'Canada', lat: 56.0, lng: -106.0, region: 'na' },
    { code: 'AU', name: 'Australia', lat: -25.0, lng: 134.0, region: 'aus' },
    { code: 'NZ', name: 'New Zealand', lat: -41.0, lng: 174.0, region: 'aus' },
    { code: 'SA', name: 'Saudi Arabia', lat: 24.0, lng: 45.0, region: 'gulf' },
    { code: 'AE', name: 'UAE', lat: 24.4, lng: 54.4, region: 'gulf' },
    { code: 'QA', name: 'Qatar', lat: 25.3, lng: 51.2, region: 'gulf' },
    { code: 'MY', name: 'Malaysia', lat: 4.2, lng: 102.0, region: 'asia' },
    { code: 'JP', name: 'Japan', lat: 36.2, lng: 138.2, region: 'asia' },
    { code: 'KR', name: 'South Korea', lat: 36.5, lng: 128.0, region: 'asia' },
    { code: 'TR', name: 'Turkiye', lat: 39.0, lng: 35.0, region: 'asia' }
  ];
  const R = 1;
  function ll2v(lat, lng, r) {
    const phi = (90 - lat) * Math.PI / 180, theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  function glowSprite(hex, size) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    const col = '#' + hex.toString(16).padStart(6, '0');
    grd.addColorStop(0, col); grd.addColorStop(0.35, col + 'aa'); grd.addColorStop(1, col + '00');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.scale.set(size, size, 1); return m;
  }

  function init(container, counts, onSelect, opts) {
    if (!window.THREE) return null;
    opts = opts || {};
    const num = c => (counts[c] && (typeof counts[c] === 'object' ? counts[c].total : counts[c])) || 0;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bg = !!opts.background;
    let W = container.clientWidth || window.innerWidth, H = container.clientHeight || window.innerHeight;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    // Background mode shifts the globe right so floating UI sits over open space at left.
    camera.position.set(0, 0.35, opts.compact ? 3.4 : 3.1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, bg ? 1.25 : 1.5));
    renderer.setSize(W, H);
    container.appendChild(renderer.domElement);

    const world = new THREE.Group(); scene.add(world);
    if (bg) world.position.x = W / H > 1.1 ? 0.6 : 0;

    // --- stars (two depth layers + twinkle) --- (r128-safe random direction)
    function randDir() {
      const u = Math.random(), v = Math.random();
      const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1);
      return new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    }
    let starMat, starMat2;
    (function () {
      const mk = (n, dist, size, color) => {
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const v = randDir().multiplyScalar(dist + Math.random() * dist * 0.5); pos.set([v.x, v.y, v.z], i * 3); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.85 });
        scene.add(new THREE.Points(g, mat)); return mat;
      };
      starMat = mk(1400, 20, 0.05, 0x9db8e8);   // near, blue-white
      starMat2 = mk(700, 34, 0.09, 0xdbe8ff);   // far, brighter
    })();

    // --- globe body: ocean sphere with sun-lit day/night shading + sea glint ---
    world.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 48, 48),
      new THREE.MeshPhongMaterial({ color: 0x0b2148, emissive: 0x050e20, specular: 0x6ea8ff, shininess: 42, transparent: true, opacity: 0.97 })));
    (function () { // fibonacci dot field
      const n = 1400, pos = new Float32Array(n * 3), ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = ga * i;
        pos.set([Math.cos(th) * rad * R, y * R, Math.sin(th) * rad * R], i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      world.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x2f5ea8, size: 0.014, transparent: true, opacity: 0.85 })));
    })();
    (function () { // graticule rings
      const mat = new THREE.LineBasicMaterial({ color: 0x1d3f74, transparent: true, opacity: 0.5 });
      for (let la = -60; la <= 60; la += 30) {
        const pts = []; for (let lo = 0; lo <= 360; lo += 6) pts.push(ll2v(la, lo, R * 1.001));
        world.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
      }
      for (let lo = 0; lo < 360; lo += 30) {
        const pts = []; for (let la = -90; la <= 90; la += 6) pts.push(ll2v(la, lo, R * 1.001));
        world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      }
    })();
    // atmosphere glow (procedural sprite behind globe)
    const atmo = glowSprite(0x3b82f6, 3.4); atmo.position.set(0, 0, -0.2); scene.add(atmo);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.25); sun.position.set(6, 2.4, 4); scene.add(sun);
    // Visible sun with warm glow — slowly orbits, creating a day/night cycle and "sunrise" over the globe.
    const sunGlow = glowSprite(0xffd9a0, 1.6); scene.add(sunGlow);
    const sunCore = glowSprite(0xffffff, 0.55); scene.add(sunCore);
    let sunAng = -0.6; // starts low: rising-sun feel
    function placeSun() {
      const sx = Math.cos(sunAng) * 7, sy = 1.4 + Math.sin(sunAng * 0.7) * 1.6, sz = Math.sin(sunAng) * 7;
      sun.position.set(sx, sy, sz);
      sunGlow.position.set(sx * 0.92, sy * 0.92, sz * 0.92);
      sunCore.position.copy(sunGlow.position);
    }
    placeSun();

    // Fresnel rim atmosphere (original shader — technique studied from webgl-globe/three-globe,
    // written fresh here): brightens at the sphere's silhouette for a glowing edge.
    (function () {
      const mat = new THREE.ShaderMaterial({
        transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
        uniforms: { c: { value: 0.55 }, p: { value: 3.2 }, glowColor: { value: new THREE.Color(0x3b82f6) } },
        vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 glowColor; uniform float c; uniform float p; varying vec3 vN; void main(){ float i = pow( c - dot(vN, vec3(0.0,0.0,1.0)), p ); gl_FragColor = vec4(glowColor, clamp(i,0.0,1.0)); }'
      });
      const shell = new THREE.Mesh(new THREE.SphereGeometry(R * 1.18, 48, 48), mat);
      world.add(shell);
    })();

    // --- country nodes (with pulse rings) ---
    const pk = COUNTRIES[0];
    const nodes = [], pulses = [];
    COUNTRIES.forEach(c => {
      const col = REGIONS[c.region].color;
      const grp = new THREE.Group();
      const dot = new THREE.Mesh(new THREE.SphereGeometry(c.region === 'pk' ? 0.03 : 0.021, 14, 14),
        new THREE.MeshBasicMaterial({ color: col }));
      const halo = glowSprite(col, c.region === 'pk' ? 0.26 : 0.17);
      const halo2 = glowSprite(0xffffff, c.region === 'pk' ? 0.12 : 0.07); // hot white core
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.038, 28),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      grp.add(dot); grp.add(halo); grp.add(halo2); grp.add(ring);
      grp.position.copy(ll2v(c.lat, c.lng, R * 1.005));
      ring.lookAt(new THREE.Vector3(0, 0, 0).sub(grp.position).multiplyScalar(-2));
      grp.userData = c;
      world.add(grp); nodes.push(grp); pulses.push({ ring, t: Math.random() });
    });
    // futuristic tilted orbit ring around the planet
    (function () {
      const ring = new THREE.Mesh(new THREE.RingGeometry(R * 1.45, R * 1.47, 90),
        new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
      ring.rotation.x = Math.PI / 2.4; ring.rotation.y = 0.3;
      scene.add(ring);
      const ring2 = ring.clone(); ring2.material = ring.material.clone(); ring2.material.opacity = 0.12;
      ring2.scale.setScalar(1.12); scene.add(ring2);
    })();

    // --- flight arcs from Pakistan + particles + aircraft ---
    const start = ll2v(pk.lat, pk.lng, R * 1.005);
    const flights = [];
    COUNTRIES.slice(1).forEach((c, i) => {
      const end = ll2v(c.lat, c.lng, R * 1.005);
      // Altitude proportional to great-circle distance (technique from three-globe, own code).
      const gc = start.distanceTo(end);
      const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(R * (1.15 + gc * 0.42));
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const col = REGIONS[c.region].color;
      // Flowing dashed arc: LineDashedMaterial with animated dashOffset for travel motion.
      const pts = curve.getPoints(80);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: col, transparent: true, opacity: 0.55, dashSize: 0.06, gapSize: 0.04, linewidth: 1 }));
      line.computeLineDistances();
      world.add(line);
      const particle = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), new THREE.MeshBasicMaterial({ color: col }));
      world.add(particle);
      // procedural aircraft
      const plane = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.045, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      body.rotation.x = Math.PI / 2;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.002, 0.012), new THREE.MeshBasicMaterial({ color: 0xdbeafe }));
      plane.add(body); plane.add(wing);
      world.add(plane);
      // motion trail behind the aircraft (technique from AirTrails3D, own implementation)
      const TN = 14, tpos = new Float32Array(TN * 3);
      const tgeo = new THREE.BufferGeometry(); tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
      const trail = new THREE.Line(tgeo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.5 }));
      world.add(trail);
      // comet-tail particles flowing along the arc (guaranteed-visible motion in r128)
      const CN = 6, cpos = new Float32Array(CN * 3);
      const cgeo = new THREE.BufferGeometry(); cgeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
      const comets = new THREE.Points(cgeo, new THREE.PointsMaterial({ color: col, size: 0.02, transparent: true, opacity: 0.9 }));
      world.add(comets);
      flights.push({ curve, particle, plane, line, trail, comets, CN, TN, t: Math.random(), speed: 0.0016 + Math.random() * 0.0012, dash: 0 });
    });

    // --- interaction: drag rotate, hover, click ---
    const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
    let dragging = false, px = 0, py = 0, vy = 0.0016, vx = 0, hovered = null, selected = null, zoomed = false;
    const tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;pointer-events:none;background:rgba(10,25,50,.92);color:#fff;font:600 12px Inter,sans-serif;padding:6px 10px;border-radius:8px;border:1px solid rgba(120,160,255,.4);display:none;z-index:5;white-space:nowrap';
    container.style.position = 'relative'; container.appendChild(tip);

    function pointer(e) { const r = container.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; mouse.x = ((t.clientX - r.left) / r.width) * 2 - 1; mouse.y = -((t.clientY - r.top) / r.height) * 2 + 1; return t; }
    container.addEventListener('pointerdown', e => { dragging = true; const t = pointer(e); px = t.clientX; py = t.clientY; });
    window.addEventListener('pointerup', () => dragging = false);
    container.addEventListener('pointermove', e => {
      const t = pointer(e);
      if (dragging) { vy = (t.clientX - px) * 0.00022 + 0.0008; vx = (t.clientY - py) * 0.00018; px = t.clientX; py = t.clientY; }
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(nodes.map(n => n.children[0]));
      const grp = hit.length ? hit[0].object.parent : null;
      if (hovered && hovered !== grp) { hovered.scale.setScalar(1); }
      hovered = grp;
      if (grp) {
        grp.scale.setScalar(1.6);
        const c = grp.userData, n = num(c.code);
        tip.textContent = c.name + (c.code === 'PK' ? ' · home' : ' · ' + n + ' verified ' + (n === 1 ? 'opportunity' : 'opportunities'));
        const r = container.getBoundingClientRect();
        tip.style.left = ((mouse.x + 1) / 2 * r.width + 12) + 'px';
        tip.style.top = ((-mouse.y + 1) / 2 * r.height - 10) + 'px';
        tip.style.display = 'block'; container.style.cursor = 'pointer';
      } else { tip.style.display = 'none'; container.style.cursor = 'grab'; }
    });
    container.addEventListener('click', () => {
      if (!hovered) {
        if (zoomed && window.gsap) { zoomed = false; gsap.to(camera.position, { x: 0, y: 0.35, z: 3.1, duration: 1, ease: 'power2.inOut' }); if (onSelect) onSelect(null); }
        return;
      }
      selected = hovered.userData;
      const p = hovered.position.clone().normalize();
      const target = p.clone().multiplyScalar(2.05).add(new THREE.Vector3(0, 0.18, 0));
      if (window.gsap) { zoomed = true; gsap.to(camera.position, { x: target.x, y: target.y, z: target.z, duration: 1.1, ease: 'power2.inOut' }); }
      if (onSelect) onSelect({ code: selected.code, name: selected.name, count: num(selected.code), detail: (typeof counts[selected.code] === 'object' ? counts[selected.code] : null) });
    });

    // --- loop ---
    let raf = null, running = true;
    function tick() {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      world.rotation.y += dragging ? vy : (vy = vy * 0.95 + 0.0016 * 0.05);
      world.rotation.x += dragging ? vx : (vx *= 0.92);
      world.rotation.x = Math.max(-0.6, Math.min(0.6, world.rotation.x));
      pulses.forEach(p => {
        p.t = (p.t + 0.014) % 1;
        const s = 1 + p.t * 1.8;
        p.ring.scale.setScalar(s);
        p.ring.material.opacity = 0.9 * (1 - p.t);
      });
      if (starMat) starMat.opacity = 0.7 + Math.sin(Date.now() * 0.0012) * 0.18;
      if (starMat2) starMat2.opacity = 0.7 + Math.sin(Date.now() * 0.0012 + 2) * 0.22;
      // slow sunrise/day-night cycle (~4 min per orbit) + gentle cinematic camera drift
      sunAng += 0.0006; placeSun();
      if (!dragging && !zoomed) {
        camera.position.x += (Math.sin(Date.now() * 0.00012) * 0.06 - camera.position.x * 0.0) * 0.002;
        camera.position.y += ((0.35 + Math.sin(Date.now() * 0.00009) * 0.05) - camera.position.y) * 0.01;
      }
      flights.forEach(f => {
        f.t = (f.t + f.speed) % 1;
        f.particle.position.copy(f.curve.getPoint((f.t + 0.5) % 1));
        const p = f.curve.getPoint(f.t); f.plane.position.copy(p);
        const tan = f.curve.getTangent(f.t); f.plane.lookAt(p.clone().add(tan));
        // flowing dash motion along the arc
        f.dash -= 0.01; f.line.material.dashOffset = f.dash;
        // update trail: shift history, write current head
        const arr = f.trail.geometry.attributes.position.array;
        for (let k = f.TN - 1; k > 0; k--) { arr[k * 3] = arr[(k - 1) * 3]; arr[k * 3 + 1] = arr[(k - 1) * 3 + 1]; arr[k * 3 + 2] = arr[(k - 1) * 3 + 2]; }
        arr[0] = p.x; arr[1] = p.y; arr[2] = p.z;
        f.trail.geometry.attributes.position.needsUpdate = true;
        // comet particles trailing behind aircraft along the curve
        const cp = f.comets.geometry.attributes.position.array;
        for (let k = 0; k < f.CN; k++) {
          const ct = (f.t - (k + 1) * 0.022 + 1) % 1;
          const q = f.curve.getPoint(ct);
          cp[k * 3] = q.x; cp[k * 3 + 1] = q.y; cp[k * 3 + 2] = q.z;
        }
        f.comets.geometry.attributes.position.needsUpdate = true;
      });
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    tick();
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) tick(); });
    function onResize() {
      W = bg ? window.innerWidth : container.clientWidth;
      H = bg ? window.innerHeight : container.clientHeight;
      if (!W || !H) return;
      camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H);
      if (bg) world.position.x = W / H > 1.1 ? 0.6 : 0;
    }
    window.addEventListener('resize', onResize);

    return {
      stop() { running = false; if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); renderer.dispose(); container.innerHTML = ''; },
      resetView() { if (window.gsap) { zoomed = false; gsap.to(camera.position, { x: 0, y: 0.35, z: opts.compact ? 3.4 : 3.1, duration: 1, ease: 'power2.inOut' }); } if (onSelect) onSelect(null); },
      canvas: renderer.domElement
    };
  }

  function supported() {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); }
    catch (e) { return false; }
  }

  window.FFGlobe = { init, supported, COUNTRIES, REGIONS };
})();
