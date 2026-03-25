import { webgpu, WGPUView } from "electrobun/bun";

const TRIANGLE_WGSL = `
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>( 0.0,  0.5),
    vec2<f32>(-0.5, -0.5),
    vec2<f32>( 0.5, -0.5),
  );
  return vec4<f32>(pos[idx], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.2, 0.6, 1.0, 1.0);
}
`;

export async function renderTriangle(view: WGPUView): Promise<() => void> {
	const { context: ctx } = webgpu.createContext(view);

	const adapter = await webgpu.navigator.requestAdapter({ compatibleSurface: ctx });
	if (!adapter) throw new Error("No WebGPU adapter available");

	const device = await adapter.requestDevice();

	ctx.configure({
		device,
		format: "bgra8unorm",
		alphaMode: "opaque",
	});

	const shader = device.createShaderModule({ code: TRIANGLE_WGSL });

	const pipeline = device.createRenderPipeline({
		layout: "auto",
		vertex: {
			module: shader,
			entryPoint: "vs_main",
		},
		fragment: {
			module: shader,
			entryPoint: "fs_main",
			targets: [{ format: "bgra8unorm" }],
		},
		primitive: { topology: "triangle-list" },
	});

	let running = true;

	function frame() {
		if (!running) return;

		try {
			const texture = ctx.getCurrentTexture();
			const textureView = texture.createView();

			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: textureView,
						clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
						loadOp: "clear",
						storeOp: "store",
					},
				],
			});

			pass.setPipeline(pipeline);
			pass.draw(3);
			pass.end();

			device.queue.submit([encoder.finish()]);
			ctx.present();
		} catch (err) {
			console.error("[WebGPU] Frame error:", err);
			running = false;
			return;
		}

		setTimeout(frame, 16);
	}

	frame();

	return () => {
		running = false;
	};
}
