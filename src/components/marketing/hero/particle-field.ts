/**
 * Hero point field.
 *
 * One GPU draw call. Every point holds two positions: a scattered position and
 * a position on one of seven upright 9:16 frames. Scroll progress drives a
 * staggered morph from the first to the second, left to right, so the visual
 * says what the product says: loose product material resolving into finished
 * video frames.
 *
 * Written against raw WebGL2 rather than a scene graph. A single point cloud
 * does not need one, and skipping it keeps the hero payload small.
 */

const POINT_COUNT = 26_000;
const FRAME_COUNT = 7;
const FRAME_WIDTH = 1.52;
const FRAME_HEIGHT = (FRAME_WIDTH * 16) / 9;
const FRAME_SPACING = 1.98;
const FOV = (42 * Math.PI) / 180;
const MIN_DIST = 9.8;
const MAX_DIST = 15.6;

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 aScatter;
in vec3 aFrame;
in vec3 aSeed;

uniform mat4 uProj;
uniform float uTime;
uniform float uMorph;
uniform float uRotY;
uniform float uRotX;
uniform float uDist;
uniform float uSize;

out float vFade;
out float vTint;

vec2 spin(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

float easeInOutCubic(float t) {
  return t < 0.5
    ? 4.0 * t * t * t
    : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
}

void main() {
  // aSeed.x is the point's normalised horizontal home, so the morph sweeps
  // across the field instead of resolving everywhere at once.
  float lead = aSeed.x * 0.5;
  float progress = clamp(uMorph * 1.5 - lead, 0.0, 1.0);
  float resolved = easeInOutCubic(progress);

  vec3 p = mix(aScatter, aFrame, resolved);

  float drift = 1.0 - resolved * 0.86;
  p.x += sin(uTime * 0.34 + aSeed.y * 11.0) * 0.09 * drift;
  p.y += cos(uTime * 0.28 + aSeed.z * 13.0) * 0.08 * drift;
  p.z += sin(uTime * 0.22 + aSeed.y * 8.0) * 0.10 * drift;

  p.xz = spin(p.xz, uRotY);
  p.yz = spin(p.yz, uRotX);

  vec4 viewPos = vec4(p.x, p.y, p.z - uDist, 1.0);
  gl_Position = uProj * viewPos;

  float depth = -viewPos.z;
  gl_PointSize = max(
    1.0,
    uSize * (0.55 + aSeed.y * 1.15) * (7.5 / max(0.4, depth))
  );

  vFade = smoothstep(uDist + 5.0, uDist - 4.2, depth);
  vTint = clamp(
    resolved * 0.22 + step(0.972, aSeed.z) * 0.95 + aSeed.z * 0.06,
    0.0,
    1.0
  );
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vFade;
in float vTint;

uniform vec3 uCool;
uniform vec3 uAccent;
uniform float uIntensity;

out vec4 outColor;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  float mask = smoothstep(0.25, 0.015, r2);
  if (mask <= 0.001) discard;

  float weight = mask * vFade * uIntensity;
  vec3 tone = mix(uCool, uAccent, vTint);

  // Premultiplied additive output. Overlapping points accumulate into light.
  outColor = vec4(tone * weight, weight);
}
`;

export type ParticleField = {
  setScrollProgress(progress: number): void;
  destroy(): void;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perspective(fov: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  // Column-major, as WebGL expects.
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function buildGeometry() {
  const scatter = new Float32Array(POINT_COUNT * 3);
  const frame = new Float32Array(POINT_COUNT * 3);
  const seed = new Float32Array(POINT_COUNT * 3);
  const random = mulberry32(20260830);

  const halfSpan = ((FRAME_COUNT - 1) * FRAME_SPACING) / 2;
  const perimeter = 2 * (FRAME_WIDTH + FRAME_HEIGHT);
  const frameLift: number[] = [];
  for (let f = 0; f < FRAME_COUNT; f += 1) {
    frameLift.push((random() - 0.5) * 0.34);
  }

  for (let i = 0; i < POINT_COUNT; i += 1) {
    const o = i * 3;

    // Scattered home: a wide, flattened shell so the cloud fills the frame
    // horizontally without turning into a ball.
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - u * u));
    const radius = 2.0 + Math.pow(random(), 0.65) * 3.6;
    scatter[o] = ring * Math.cos(theta) * radius * 1.45;
    scatter[o + 1] = u * radius * 0.5;
    scatter[o + 2] = ring * Math.sin(theta) * radius * 0.85;

    // Resolved home: a point on one of the frames, mostly on its outline so
    // the rectangles actually read as frames.
    const frameIndex = Math.min(
      FRAME_COUNT - 1,
      Math.floor(random() * FRAME_COUNT),
    );
    const centerX = frameIndex * FRAME_SPACING - halfSpan;
    const centerZ = -(centerX * centerX) * 0.055;
    const yaw = centerX * 0.052;

    let localX: number;
    let localY: number;
    if (random() < 0.72) {
      const walk = random() * perimeter;
      if (walk < FRAME_WIDTH) {
        localX = -FRAME_WIDTH / 2 + walk;
        localY = FRAME_HEIGHT / 2;
      } else if (walk < FRAME_WIDTH + FRAME_HEIGHT) {
        localX = FRAME_WIDTH / 2;
        localY = FRAME_HEIGHT / 2 - (walk - FRAME_WIDTH);
      } else if (walk < 2 * FRAME_WIDTH + FRAME_HEIGHT) {
        localX = FRAME_WIDTH / 2 - (walk - FRAME_WIDTH - FRAME_HEIGHT);
        localY = -FRAME_HEIGHT / 2;
      } else {
        localX = -FRAME_WIDTH / 2;
        localY = -FRAME_HEIGHT / 2 + (walk - 2 * FRAME_WIDTH - FRAME_HEIGHT);
      }
      localX += (random() - 0.5) * 0.04;
      localY += (random() - 0.5) * 0.04;
    } else {
      localX = (random() - 0.5) * FRAME_WIDTH * 0.94;
      localY = (random() - 0.5) * FRAME_HEIGHT * 0.94;
    }

    frame[o] = centerX + localX * Math.cos(yaw);
    frame[o + 1] = localY + frameLift[frameIndex];
    frame[o + 2] = centerZ + localX * Math.sin(yaw);

    seed[o] = halfSpan === 0 ? 0.5 : (centerX + halfSpan) / (halfSpan * 2);
    seed[o + 1] = random();
    seed[o + 2] = random();
  }

  return { scatter, frame, seed };
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Shader compile failed:", gl.getShaderInfoLog(shader));
    }
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createParticleField(
  canvas: HTMLCanvasElement,
): ParticleField | null {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
  });
  if (!context) return null;
  const gl = context;

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Program link failed:", gl.getProgramInfoLog(program));
    }
    gl.deleteProgram(program);
    return null;
  }

  const { scatter, frame, seed } = buildGeometry();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const buffers: WebGLBuffer[] = [];
  const bind = (name: string, data: Float32Array) => {
    const buffer = gl.createBuffer();
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  };

  bind("aScatter", scatter);
  bind("aFrame", frame);
  bind("aSeed", seed);
  gl.bindVertexArray(null);

  const u = {
    proj: gl.getUniformLocation(program, "uProj"),
    time: gl.getUniformLocation(program, "uTime"),
    morph: gl.getUniformLocation(program, "uMorph"),
    rotY: gl.getUniformLocation(program, "uRotY"),
    rotX: gl.getUniformLocation(program, "uRotX"),
    dist: gl.getUniformLocation(program, "uDist"),
    size: gl.getUniformLocation(program, "uSize"),
    cool: gl.getUniformLocation(program, "uCool"),
    accent: gl.getUniformLocation(program, "uAccent"),
    intensity: gl.getUniformLocation(program, "uIntensity"),
  };

  gl.useProgram(program);
  gl.uniform3f(u.cool, 0.78, 0.84, 0.94);
  gl.uniform3f(u.accent, 0.847, 0.965, 0.318);
  gl.uniform1f(u.intensity, 1.18);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  let projection = perspective(FOV, 1.8, 0.1, 120);
  let dist = MIN_DIST;
  let sizeScale = 3.6;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  let time = reduceMotion ? 4.2 : 0;
  let morph = reduceMotion ? 0.52 : 0;
  let scroll = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerTargetX = 0;
  let pointerTargetY = 0;

  let rafId = 0;
  let running = false;
  let lastFrameTime = 0;
  let inView = true;
  let disposed = false;

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, width < 640 ? 1.5 : 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);

    const aspect = pixelWidth / pixelHeight;
    // Pull back on narrow viewports so the frame row still reads, but cap it so
    // the points do not shrink into dust.
    dist = Math.min(MAX_DIST, Math.max(MIN_DIST, 17.7 / Math.max(aspect, 0.5)));
    sizeScale = dpr * 3.6 * (dist / MIN_DIST);
    projection = perspective(FOV, aspect, 0.1, 120);
  }

  function draw(rotY: number, rotX: number) {
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(u.proj, false, projection);
    gl.uniform1f(u.time, time);
    gl.uniform1f(u.morph, morph);
    gl.uniform1f(u.rotY, rotY);
    gl.uniform1f(u.rotX, rotX);
    gl.uniform1f(u.dist, dist);
    gl.uniform1f(u.size, sizeScale);
    gl.drawArrays(gl.POINTS, 0, POINT_COUNT);
    gl.bindVertexArray(null);
  }

  function tick(now: number) {
    if (disposed) return;
    rafId = requestAnimationFrame(tick);

    const delta = lastFrameTime
      ? Math.min(0.05, (now - lastFrameTime) / 1000)
      : 0.016;
    lastFrameTime = now;
    time += delta;

    // Idle breathing keeps a few frames formed at rest. Scroll finishes the job.
    const idle = 0.26 + 0.13 * Math.sin(time * 0.145);
    const target = Math.min(1, idle + scroll * 0.95);
    morph += (target - morph) * Math.min(1, delta * 3.2);

    pointerX += (pointerTargetX - pointerX) * Math.min(1, delta * 2.4);
    pointerY += (pointerTargetY - pointerY) * Math.min(1, delta * 2.4);

    const settle = 1 - morph * 0.6;
    const rotY = (Math.sin(time * 0.075) * 0.3 + pointerX * 0.34) * settle;
    const rotX = (Math.cos(time * 0.061) * 0.055 - pointerY * 0.17) * settle;

    draw(rotY, rotX);
  }

  function start() {
    if (running || disposed || reduceMotion) return;
    running = true;
    lastFrameTime = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  const onPointerMove = (event: PointerEvent) => {
    pointerTargetX = (event.clientX / window.innerWidth) * 2 - 1;
    pointerTargetY = (event.clientY / window.innerHeight) * 2 - 1;
  };

  const onVisibility = () => {
    if (document.hidden) stop();
    else if (inView) start();
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    stop();
  };

  const resizeObserver = new ResizeObserver(() => {
    measure();
    if (!running) draw(-0.16, 0.03);
  });

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      inView = entries[0]?.isIntersecting ?? true;
      if (inView && !document.hidden) start();
      else stop();
    },
    { rootMargin: "120px" },
  );

  measure();
  resizeObserver.observe(canvas);
  canvas.addEventListener("webglcontextlost", onContextLost);

  if (reduceMotion) {
    // One static, composed frame. No loop, no pointer tracking.
    draw(-0.16, 0.03);
  } else {
    intersectionObserver.observe(canvas);
    if (finePointer) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    start();
  }

  return {
    setScrollProgress(progress: number) {
      scroll = Math.min(1, Math.max(0, progress));
    },
    destroy() {
      disposed = true;
      stop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      buffers.forEach((buffer) => gl.deleteBuffer(buffer));
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
