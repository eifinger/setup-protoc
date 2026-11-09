import type { IncomingHttpHeaders } from "node:http";
import { text } from "node:stream/consumers";
import timers from "node:timers/promises";
import * as core from "@actions/core";
import { HttpClient } from "@actions/http-client";

export interface Asset {
  name: string;
  digest?: string | null;
}

export interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Asset[];
}

export class Releases {
  private readonly client: HttpClient;

  constructor(token: string) {
    this.client = new HttpClient("eifinger/setup-protoc", [], {
      // Retry here so network errors and GitHub rate-limit headers use one budget.
      allowRetries: false,
      // The canonical API URL needs no redirects; toolkit redirect bodies are unbounded.
      allowRedirects: false,
      socketTimeout: 30_000,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  async get(suffix: string): Promise<Release> {
    return this.request<Release>(suffix);
  }

  async list(): Promise<Release[]> {
    const releases: Release[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.request<Release[]>(`?per_page=100&page=${page}`);
      releases.push(...batch);
      if (batch.length < 100) return releases;
    }
  }

  private async request<T>(suffix: string): Promise<T> {
    const url = `https://api.github.com/repos/protocolbuffers/protobuf/releases${suffix}`;
    try {
      for (let attempt = 0; ; attempt++) {
        let delay = 1_000 * 2 ** attempt;
        let failure: Error;
        let headers: IncomingHttpHeaders = {};
        let rateLimited = false;
        try {
          const response = await this.client.get(url);
          const status = response.message.statusCode ?? 0;
          headers = response.message.headers;
          rateLimited =
            status === 429 ||
            (status === 403 &&
              (headers["retry-after"] !== undefined ||
                headers["x-ratelimit-remaining"] === "0"));
          const timeout = setTimeout(() => {
            response.message.destroy(
              Object.assign(
                new Error(
                  "GitHub API response body timed out after 30 seconds",
                ),
                {
                  code: "ETIMEDOUT",
                },
              ),
            );
          }, 30_000);
          let body: string;
          try {
            // Unlike the toolkit's readBody(), this rejects interrupted streams.
            body = await text(response.message);
          } finally {
            clearTimeout(timeout);
          }
          if (status >= 200 && status < 300) {
            const result = JSON.parse(body) as T | null;
            if (!result) throw new Error(`Empty response from ${url}`);
            return result;
          }
          failure = new Error(`GitHub API returned HTTP ${status}: ${body}`);
          rateLimited ||= status === 403 && /rate limit/i.test(body);
          if (
            !rateLimited &&
            status !== 408 &&
            !(status >= 500 && status < 600)
          ) {
            throw failure;
          }
        } catch (error) {
          const networkError = error as NodeJS.ErrnoException;
          if (
            ![
              "ECONNRESET",
              "ECONNREFUSED",
              "ETIMEDOUT",
              "EAI_AGAIN",
              "ENOTFOUND",
              "ENETUNREACH",
              "EHOSTUNREACH",
              "EPIPE",
              "ERR_STREAM_PREMATURE_CLOSE",
            ].includes(networkError.code ?? "") &&
            !networkError.message?.startsWith("Request timeout:")
          ) {
            throw error;
          }
          failure = networkError;
        }
        if (attempt >= 3) throw failure;
        // Keep received retry headers even when reading the body fails.
        const retryAfter = headers["retry-after"];
        const retryAt =
          typeof retryAfter === "string"
            ? /^\d+$/.test(retryAfter)
              ? Date.now() + Number(retryAfter) * 1_000
              : Date.parse(retryAfter)
            : Number.NaN;
        const resetAt =
          headers["x-ratelimit-remaining"] === "0"
            ? Number(headers["x-ratelimit-reset"]) * 1_000
            : Number.NaN;
        if (Number.isFinite(retryAt) || Number.isFinite(resetAt)) {
          // If both headers apply, do not retry before either deadline.
          delay = Math.max(
            delay,
            Number.isFinite(retryAt) ? retryAt - Date.now() : 0,
            Number.isFinite(resetAt) ? resetAt - Date.now() : 0,
          );
        } else if (rateLimited) {
          // GitHub requires at least one minute for secondary rate limits.
          delay = 60_000 * 2 ** attempt;
        }
        if (delay > 60_000) {
          throw new Error(
            `${failure.message} Required retry delay exceeds 60 seconds; try again later.`,
          );
        }
        core.info(
          `GitHub API request failed; retrying in ${delay / 1_000}s (${attempt + 1}/3).`,
        );
        await timers.setTimeout(delay);
      }
    } catch (error) {
      throw new Error(
        `Unable to read protobuf releases from GitHub. Check the version and github-token (API rate limits may apply). ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
