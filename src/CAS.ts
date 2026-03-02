import type { LiveTokenStore } from "./LiveTokenStore";
import { S3RN } from "./S3RN";
import type { SharedFolder } from "./SharedFolder";
import type { SyncFile } from "./SyncFile";
import { customFetch } from "./customFetch";
import PocketBase from "pocketbase";
import { HasLogging } from "./debug";

export class ContentAddressedStore extends HasLogging {
	private pb: PocketBase;
	private tokenStore: LiveTokenStore;

	private async parseJsonBody(
		response: Response,
	): Promise<Record<string, unknown>> {
		const responseText = await response.text();
		if (!responseText.trim()) {
			return {};
		}
		try {
			return JSON.parse(responseText) as Record<string, unknown>;
		} catch (_error) {
			throw new Error(
				`Invalid JSON response (${response.status}) from CAS endpoint`,
			);
		}
	}

	constructor(private sharedFolder: SharedFolder) {
		super();
		const authUrl = sharedFolder.loginManager.getEndpointManager().getAuthUrl();
		this.pb = new PocketBase(authUrl, sharedFolder.loginManager.authStore);
		this.tokenStore = sharedFolder.tokenStore;
	}

	async verify(syncFile: SyncFile): Promise<boolean> {
		if (!syncFile.meta) {
			throw new Error("cannot head file with missing hash");
		}
		const sha256 = syncFile.meta.hash;
		const token = await this.tokenStore.getFileToken(
			S3RN.encode(syncFile.s3rn),
			sha256,
			syncFile.mimetype,
			0,
		);
		const response = await customFetch(token.baseUrl!, {
			method: "HEAD",
			headers: { Authorization: `Bearer ${token.token}` },
		});
		return response.status === 200;
	}

	async readFile(syncFile: SyncFile): Promise<ArrayBuffer> {
		if (!syncFile.meta) {
			throw new Error("cannot pull file with missing hash");
		}
		const sha256 = syncFile.meta.hash;
		const token = await this.tokenStore.getFileToken(
			S3RN.encode(syncFile.s3rn),
			sha256,
			syncFile.mimetype,
			0,
		);
		const response = await customFetch(token.baseUrl + "/download-url", {
			method: "GET",
			headers: { Authorization: `Bearer ${token.token}` },
		});
		if (response.status === 404) {
			throw new Error(
				`[${this.sharedFolder.path}] File is missing: ${syncFile.guid} ${syncFile.meta.hash} ${syncFile.meta.type}`,
			);
		}
		if (response.status !== 200) {
			throw new Error(
				`[${this.sharedFolder.path}] Failed to get download URL: HTTP ${response.status}`,
			);
		}
		const responseJson = await this.parseJsonBody(response);
		const presignedUrl = responseJson.downloadUrl;
		if (typeof presignedUrl !== "string" || !presignedUrl) {
			throw new Error(
				`[${this.sharedFolder.path}] Missing downloadUrl in CAS response`,
			);
		}
		const downloadResponse = await customFetch(presignedUrl);
		return downloadResponse.arrayBuffer();
	}

	async writeFile(syncFile: SyncFile): Promise<void> {
		const content = await syncFile.caf.read();
		const hash = await syncFile.caf.hash();
		this.log("writeFile", hash);
		if (!(content && hash)) {
			throw new Error("invalid caf");
		}
		const token = await this.tokenStore.getFileToken(
			S3RN.encode(syncFile.s3rn),
			hash,
			syncFile.mimetype,
			content.byteLength,
		);
		const response = await customFetch(token.baseUrl + "/upload-url", {
			method: "POST",
			headers: { Authorization: `Bearer ${token.token}` },
		});
		if (response.status === 204) {
			// Some endpoints return no body when upload can be skipped
			return;
		}
		const responseJson = await this.parseJsonBody(response);
		if (response.status !== 200) {
			const error = responseJson.error;
			if (typeof error === "string" && error.trim()) {
				throw new Error(error);
			}
			throw new Error(
				`[${this.sharedFolder.path}] Failed to get upload URL: HTTP ${response.status}`,
			);
		}
		const presignedUrl = responseJson.uploadUrl;
		if (typeof presignedUrl !== "string" || !presignedUrl) {
			throw new Error(
				`[${this.sharedFolder.path}] Missing uploadUrl in CAS response`,
			);
		}
		await customFetch(presignedUrl, {
			method: "PUT",
			headers: { "Content-Type": syncFile.mimetype },
			body: content,
		});
		return;
	}

	public destroy() {
		this.pb.cancelAllRequests();
		this.pb = null as any;
		this.tokenStore = null as any;
		this.sharedFolder = null as any;
	}
}
