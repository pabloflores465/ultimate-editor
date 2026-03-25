<script lang="ts">
	import { onMount } from "svelte";

	let status = $state("Iniciando WebGL...");
	let canvas: HTMLCanvasElement;

	function makeShader(
		gl: WebGLRenderingContext,
		type: number,
		source: string,
	): WebGLShader {
		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return shader;
	}

	function drawWebGL(gl: WebGLRenderingContext): void {
		const vsSource = `
			attribute vec2 a_position;
			void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
		`;
		const fsSource = `
			precision mediump float;
			void main() { gl_FragColor = vec4(0.2, 0.6, 1.0, 1.0); }
		`;

		const program = gl.createProgram()!;
		gl.attachShader(program, makeShader(gl, gl.VERTEX_SHADER, vsSource));
		gl.attachShader(program, makeShader(gl, gl.FRAGMENT_SHADER, fsSource));
		gl.linkProgram(program);
		gl.useProgram(program);

		const vertices = new Float32Array([0.0, 0.5, -0.5, -0.5, 0.5, -0.5]);
		const buffer = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

		const posLoc = gl.getAttribLocation(program, "a_position");
		gl.enableVertexAttribArray(posLoc);
		gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
		gl.viewport(0, 0, canvas.width, canvas.height);

		status = "✅ WebGL OK";

		(function frame() {
			gl.clearColor(0.08, 0.08, 0.12, 1.0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			requestAnimationFrame(frame);
		})();
	}

	function drawCanvas2D(): void {
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.fillStyle = "#0d0d18";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.beginPath();
		ctx.moveTo(320, 60);
		ctx.lineTo(80, 420);
		ctx.lineTo(560, 420);
		ctx.closePath();
		ctx.fillStyle = "#3399ff";
		ctx.fill();
	}

	onMount(() => {
		const gl =
			canvas.getContext("webgl2") ??
			(canvas.getContext("webgl") as WebGLRenderingContext | null);

		if (!gl) {
			status = "⚠️ WebGL no disponible — usando Canvas 2D";
			drawCanvas2D();
			return;
		}

		try {
			drawWebGL(gl);
		} catch (err) {
			status = `❌ Error: ${String(err)}`;
		}
	});
</script>

<div class="flex flex-col items-center gap-4 p-8">
	<h1 class="text-2xl font-bold text-indigo-500">WebGL Triangle</h1>
	<p class="text-sm text-yellow-400">{status}</p>
	<canvas
		bind:this={canvas}
		width={640}
		height={480}
		class="rounded"
		style="border: 2px solid #6366f1;"
	></canvas>
	<a href="/#" class="text-sm text-indigo-400 hover:underline">← Volver</a>
</div>
