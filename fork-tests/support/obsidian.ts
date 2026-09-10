/**
 * Stand-in for the `obsidian` module, which ships types only and has no
 * runtime to import under jest.
 *
 * Requests are routed to a handler the test installs, so a test can drive the
 * real PocketBase client and the real `customFetch` and still decide what the
 * server says.
 */

export interface RequestUrlParam {
	url: string;
	method?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
	contentType?: string;
}

export interface RequestUrlResponse {
	status: number;
	arrayBuffer: ArrayBuffer;
	headers: Record<string, string>;
	json: unknown;
	text: string;
}

export type RequestUrlResponsePromise = Promise<RequestUrlResponse>;

export type RequestHandler = (
	request: RequestUrlParam,
) => RequestUrlResponse | Promise<RequestUrlResponse>;

export const apiVersion = "1.6.6";

export const Platform = {
	isIosApp: false,
	isDesktopApp: true,
	isMobile: false,
};

export class Notice {
	constructor(public message: string) {}
	hide() {}
}

let handler: RequestHandler | undefined;

/** Build a RequestUrlResponse the way Obsidian would. */
export function jsonResponse(status: number, body: unknown): RequestUrlResponse {
	const text = JSON.stringify(body ?? {});
	const bytes = new TextEncoder().encode(text);
	return {
		status,
		arrayBuffer: bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer,
		headers: { "content-type": "application/json" },
		json: body,
		text,
	};
}

export function setRequestHandler(next: RequestHandler) {
	handler = next;
}

export function resetRequestHandler() {
	handler = undefined;
}

export const requestUrl = async (
	request: RequestUrlParam,
): Promise<RequestUrlResponse> => {
	if (!handler) {
		throw new Error(`fork-tests: unhandled request to ${request.url}`);
	}
	return handler(request);
};
