import crypto from 'node:crypto';
import axios, { AxiosInstance } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { agentFor, pickProxy } from '@/lib/proxyPool';
import UserAgent from 'user-agents';
import pino from 'pino';
import yn from 'yn';
import { sleep } from '@/lib/utils';
import * as cookie from 'cookie';
import { randomUUID } from 'node:crypto';
import { Solver } from '@2captcha/captcha-solver';
import { BrowserContext, Page, Locator, chromium, firefox } from 'rebrowser-playwright-core';
import { promises as fs } from 'fs';
import path from 'node:path';

// sunoApi instance caching
const globalForSunoApi = global as unknown as { sunoApiCache?: Map<string, SunoApi> };
const cache = globalForSunoApi.sunoApiCache || new Map<string, SunoApi>();
globalForSunoApi.sunoApiCache = cache;

const logger = pino();
export const DEFAULT_MODEL = 'chirp-hawk'; // Suno v6

// Suno uses an all-zero uuid for clips you are not allowed to reference.
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';
const isValidClipId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id !== EMPTY_UUID;

export interface AudioInfo {
  id: string; // Unique identifier for the audio
  title?: string; // Title of the audio
  image_url?: string; // URL of the image associated with the audio
  lyric?: string; // Lyrics of the audio
  audio_url?: string; // URL of the audio file
  video_url?: string; // URL of the video associated with the audio
  created_at: string; // Date and time when the audio was created
  model_name: string; // Name of the model used for audio generation
  gpt_description_prompt?: string; // Prompt for GPT description
  prompt?: string; // Prompt for audio generation
  status: string; // Status
  type?: string;
  tags?: string; // Genre of music.
  negative_tags?: string; // Negative tags of music.
  duration?: string; // Duration of the audio
  error_message?: string; // Error message if any
  media_url?: string; // Direct playable CDN url (m4a)
}

interface PersonaResponse {
  persona: {
    id: string;
    name: string;
    description: string;
    image_s3_id: string;
    root_clip_id: string;
    clip: any; // You can define a more specific type if needed
    user_display_name: string;
    user_handle: string;
    user_image_url: string;
    persona_clips: Array<{
      clip: any; // You can define a more specific type if needed
    }>;
    is_suno_persona: boolean;
    is_trashed: boolean;
    is_owned: boolean;
    is_public: boolean;
    is_public_approved: boolean;
    is_loved: boolean;
    upvote_count: number;
    clip_count: number;
  };
  total_results: number;
  current_page: number;
  is_following: boolean;
}

class SunoApi {
  private static BASE_URL: string = 'https://studio-api.prod.suno.com';
  private static CLERK_BASE_URL: string = 'https://auth.suno.com';
  private static CLERK_VERSION = '5.117.0';

  private readonly client: AxiosInstance;
  private sid?: string;
  private currentToken?: string;
  private deviceId?: string;
  private userAgent?: string;
  private cookies: Record<string, string | undefined>;
  private solver = new Solver(process.env.TWOCAPTCHA_KEY + '');

  constructor(cookies: string) {
    this.userAgent = new UserAgent(/Macintosh/).random().toString(); // Usually Mac systems get less amount of CAPTCHAs
    this.cookies = cookie.parse(cookies);
    this.deviceId = this.cookies.ajs_anonymous_id || randomUUID();
    // Optional outbound proxy (Proxidize sticky sessions). Route all Suno API traffic through
    // ONE session for the life of this client: Suno validates captcha token + IP + session
    // together, so an instance that changed IP mid-conversation would have its token rejected.
    // The session is therefore picked once here, keyed on this client's device id, rather than
    // per request — different clients still land on different IPs, which is the point of a pool.
    let proxyAgent: HttpsProxyAgent<string> | undefined;
    try {
      proxyAgent = agentFor(pickProxy(this.deviceId));
    } catch (e: any) {
      // no pool configured, or every session blocked: go direct rather than refuse to start
      console.warn("[SunoApi] no usable proxy:", e?.message);
      proxyAgent = undefined;
    }
    this.client = axios.create({
      withCredentials: true,
      ...(proxyAgent ? { httpAgent: proxyAgent, httpsAgent: proxyAgent, proxy: false } : {}),
      headers: {
        'Affiliate-Id': 'undefined',
        'Device-Id': `"${this.deviceId}"`,
        'x-suno-client': 'Android prerelease-4nt180t 1.0.42',
        'X-Requested-With': 'com.suno.android',
        'sec-ch-ua': '"Chromium";v="130", "Android WebView";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'User-Agent': this.userAgent
      }
    });
    this.client.interceptors.request.use(config => {
      if (this.currentToken && !config.headers.Authorization)
        config.headers.Authorization = `Bearer ${this.currentToken}`;
      const cookiesArray = Object.entries(this.cookies).map(([key, value]) => 
        cookie.serialize(key, value as string)
      );
      config.headers.Cookie = cookiesArray.join('; ');
      return config;
    });
    this.client.interceptors.response.use(resp => {
      const setCookieHeader = resp.headers['set-cookie'];
      if (Array.isArray(setCookieHeader)) {
        const newCookies = cookie.parse(setCookieHeader.join('; '));
        for (const [key, value] of Object.entries(newCookies)) {
          this.cookies[key] = value;
        }
      }
      return resp;
    })
  }

  public async init(): Promise<SunoApi> {
    //await this.getClerkLatestVersion();
    await this.getAuthToken();
    await this.keepAlive();
    return this;
  }

  /**
   * Get the clerk package latest version id.
   * This method is commented because we are now using a hard-coded Clerk version, hence this method is not needed.
   
  private async getClerkLatestVersion() {
    // URL to get clerk version ID
    const getClerkVersionUrl = `${SunoApi.JSDELIVR_BASE_URL}/v1/package/npm/@clerk/clerk-js`;
    // Get clerk version ID
    const versionListResponse = await this.client.get(getClerkVersionUrl);
    if (!versionListResponse?.data?.['tags']['latest']) {
      throw new Error(
        'Failed to get clerk version info, Please try again later'
      );
    }
    // Save clerk version ID for auth
    SunoApi.clerkVersion = versionListResponse?.data?.['tags']['latest'];
  }
  */

  /**
   * Get the session ID and save it for later use.
   */
  private async getAuthToken() {
    logger.info('Getting the session ID');
    // URL to get session ID
    const getSessionUrl = `${SunoApi.CLERK_BASE_URL}/v1/client?__clerk_api_version=2025-11-10&_clerk_js_version=${SunoApi.CLERK_VERSION}`;
    // Get session ID
    const sessionResponse = await this.client.get(getSessionUrl, {
      headers: { Authorization: this.cookies.__client }
    });
    if (!sessionResponse?.data?.response?.last_active_session_id) {
      throw new Error(
        'Failed to get session id, you may need to update the SUNO_COOKIE'
      );
    }
    // Save session ID for later use
    this.sid = sessionResponse.data.response.last_active_session_id;
  }

  /**
   * Keep the session alive.
   * @param isWait Indicates if the method should wait for the session to be fully renewed before returning.
   */
  public async keepAlive(isWait?: boolean): Promise<void> {
    if (!this.sid) {
      throw new Error('Session ID is not set. Cannot renew token.');
    }
    // URL to renew session token
    const renewUrl = `${SunoApi.CLERK_BASE_URL}/v1/client/sessions/${this.sid}/tokens?__clerk_api_version=2025-11-10&_clerk_js_version=${SunoApi.CLERK_VERSION}`;
    // Renew session token
    logger.info('KeepAlive...\n');
    const renewResponse = await this.client.post(renewUrl, {}, {
      headers: { Authorization: this.cookies.__client }
    });
    if (isWait) {
      await sleep(1, 2);
    }
    const newToken = renewResponse.data.jwt;
    // Update Authorization field in request header with the new JWT token
    this.currentToken = newToken;
  }

  /**
   * Get the session token (not to be confused with session ID) and save it for later use.
   */
  private async getSessionToken() {
    const tokenResponse = await this.client.post(
      `${SunoApi.BASE_URL}/api/user/create_session_id/`,
      {
        session_properties: JSON.stringify({ deviceId: this.deviceId }),
        session_type: 1
      }
    );
    return tokenResponse.data.session_id;
  }

  private async captchaRequired(): Promise<boolean> {
    const resp = await this.client.post(`${SunoApi.BASE_URL}/api/c/check`, {
      ctype: 'generation'
    });
    logger.info(resp.data);
    return resp.data.required;
  }

  /**
   * Get the BrowserType from the `BROWSER` environment variable.
   * @returns {BrowserType} chromium, firefox or webkit. Default is chromium
   */
  private getBrowserType() {
    const browser = process.env.BROWSER?.toLowerCase();
    switch (browser) {
      case 'firefox':
        return firefox;
      /*case 'webkit': ** doesn't work with rebrowser-patches
      case 'safari':
        return webkit;*/
      default:
        return chromium;
    }
  }

  /**
   * Launches a browser with the necessary cookies
   * @returns {BrowserContext}
   */
  private async launchBrowser(): Promise<BrowserContext> {
    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=site-per-process',
      '--disable-features=IsolateOrigins',
      '--disable-extensions',
      '--disable-infobars'
    ];
    // Check for GPU acceleration, as it is recommended to turn it off for Docker
    if (yn(process.env.BROWSER_DISABLE_GPU, { default: false }))
      args.push('--enable-unsafe-swiftshader',
        '--disable-gpu',
        '--disable-setuid-sandbox');
    const launchOptions: any = {
      args,
      headless: yn(process.env.BROWSER_HEADLESS, { default: true })
    };
    // Prefer the real installed Chrome when available — Turnstile/Cloudflare trust its
    // fingerprint far more than the bundled Chromium (which is flagged as automation).
    if (process.env.BROWSER_CHROME_CHANNEL && ['chrome', 'msedge', 'chromium'].includes(process.env.BROWSER_CHROME_CHANNEL))
      launchOptions.channel = process.env.BROWSER_CHROME_CHANNEL;
    const browser = await this.getBrowserType().launch(launchOptions);
    // Route the captcha browser through the same proxy as the API client so the
    // solved token is bound to the IP our requests come from.
    const proxyUrl = process.env.SUNO_PROXY_URL;
    const proxy = proxyUrl ? this.parseProxy(proxyUrl) : undefined;
    const context = await browser.newContext({
      userAgent: this.userAgent,
      locale: process.env.BROWSER_LOCALE,
      viewport: { width: 1440, height: 900 },
      ...(proxy ? { proxy } : {})
    });
    const cookies = [];
    const lax: 'Lax' | 'Strict' | 'None' = 'Lax';
    cookies.push({
      name: '__session',
      value: this.currentToken+'',
      domain: '.suno.com',
      path: '/',
      sameSite: lax
    });
    for (const key in this.cookies) {
      cookies.push({
        name: key,
        value: this.cookies[key]+'',
        domain: '.suno.com',
        path: '/',
        sameSite: lax
      })
    }
    await context.addCookies(cookies);
    return context;
  }

  /**
   * Checks for CAPTCHA verification and solves the CAPTCHA if needed
   * @returns {string|null} null when no captcha is required; otherwise the RAW
   * JSON response body of the successful in-page generate/v2-web request.
   */
  public async getCaptcha(prompt: string, isCustom: boolean, tags?: string, title?: string, make_instrumental?: boolean, model?: string, negative_tags?: string, persona_id?: string): Promise<string|null> {
    if (!await this.captchaRequired())
      return null;

    logger.info('CAPTCHA required. Launching browser...')
    const browser = await this.launchBrowser();
    const page = await browser.newPage();

    // Navigate and wait until the page makes its own authenticated studio-api call,
    // then borrow that exact Authorization header for our in-page fetch.
    logger.info('Loading suno.com/create in the captcha browser...');
    await page.goto('https://suno.com/create', { referer: 'https://www.google.com/', waitUntil: 'domcontentloaded', timeout: 120000 });
    let pageAuthHeader: string | null = null;
    page.on('request', r => {
      if (r.url().includes('studio-api') && !pageAuthHeader) {
        const a = r.headers()['authorization'];
        if (a) {
          pageAuthHeader = a;
          logger.info('Captured page auth header');
        }
      }
    });
    for (let i = 0; i < 60 && !pageAuthHeader; i++)
      await sleep(2, 2);
    if (!pageAuthHeader)
      throw new Error('Page never made an authenticated studio-api call — session cookies may be stale');

    // Solve Turnstile through the proxy so the token is IP-bound to our egress.
    const token = await this.solveTurnstileVia2Captcha();
    if (!token)
      throw new Error('Turnstile solve failed — no token from 2Captcha');

    // Build the real song payload the page will submit.
    const songPayload: any = {
      make_instrumental: make_instrumental,
      mv: model || DEFAULT_MODEL,
      generation_type: 'TEXT',
      token
    };
    if (persona_id) {
      Object.assign(songPayload, await this.buildPersonaFields(persona_id));
      songPayload.metadata = { ...(songPayload.metadata || {}), is_remix: true };
    }
    if (isCustom) {
      songPayload.tags = tags;
      songPayload.title = title;
      songPayload.negative_tags = negative_tags;
      songPayload.prompt = prompt;
    } else {
      songPayload.gpt_description_prompt = prompt;
    }
    logger.info('Firing in-page generate with payload keys: ' + Object.keys(songPayload).join(','));

    const fireGenerate = (auth: string | null) => page.evaluate(async ({ body, auth }: { body: any, auth: string | null }) => {
      const r = await fetch('https://studio-api.prod.suno.com/api/generate/v2-web/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { 'Authorization': auth } : {}) },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const text = await r.text();
      return { status: r.status, body: text };
    }, { body: songPayload, auth });
    let result = { status: 0, body: '' };
    // The page can navigate (client-side router) and destroy the execution context
    // mid-fetch; retry up to 3 times, re-capturing the auth header each time and
    // giving the router a moment to settle.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await fireGenerate(pageAuthHeader);
        break;
      } catch (e: any) {
        logger.info(`page.evaluate attempt ${attempt} failed (${e.message})`);
        if (attempt === 3) {
          browser.browser()?.close().catch(() => {});
          throw new Error('In-page generate failed after 3 attempts: ' + e.message);
        }
        await sleep(5, 8);
        pageAuthHeader = null;
        page.on('request', (r: any) => {
          if (r.url().includes('studio-api') && !pageAuthHeader) {
            const a = r.headers()['authorization'];
            if (a) pageAuthHeader = a;
          }
        });
        for (let i = 0; i < 30 && !pageAuthHeader; i++)
          await sleep(2, 2);
      }
    }

    if (result.status !== 200) {
      browser.browser()?.close().catch(() => {});
      throw new Error(`In-page generate HTTP ${result.status}: ${result.body.slice(0, 200)}`);
    }

    // Capture the page's JWT for follow-up polling, close the browser, and return
    // the raw response JSON to the caller (generateSongs parses clips from it).
    this.currentToken = pageAuthHeader!.replace('Bearer ', '');
    browser.browser()?.close().catch(() => {});
    logger.info('In-page generation flow complete');
    return result.body;
  }

  /**
   * Solves Suno's generation Turnstile (captcha v2) out-of-band via the 2Captcha Turnstile API.
   * Uses the generation sitekey from Suno's own frontend bundle.
   */
  private async solveTurnstileVia2Captcha(): Promise<string|null> {
    const siteKey = process.env.SUNO_TURNSTILE_SITEKEY || '0x4AAAAAADI7xDNyj-3LcIbi';
    const pageUrl = 'https://suno.com/create';
    logger.info('Solving Turnstile via 2Captcha');
    try {
      // Solve through the same proxy as our API client so the token is bound to
      // the IP our requests originate from (Suno validates token + IP together).
      const proxyUrl = process.env.SUNO_PROXY_URL;
      const params: any = { pageurl: pageUrl, sitekey: siteKey };
      if (proxyUrl) {
        const { username, password, host, port } = this.parseProxy(proxyUrl);
        params.proxy = [username, password].filter(Boolean).join(':') + '@' + host + ':' + port;
        params.proxytype = 'HTTP';
        logger.info('2Captcha solving Turnstile via proxy ' + host + ':' + port);
      }
      const res = await this.solver.cloudflareTurnstile(params);
      logger.info('Turnstile solved by 2Captcha: ' + res.data.slice(0, 20) + '...');
      return res.data;
    } catch (e: any) {
      logger.info('2Captcha Turnstile error: ' + e.message);
      return null;
    }
  }

  /**
   * Parses a proxy URL into Playwright/2captcha proxy components.
   * Supports http://user:pass@host:port and http://host:port.
   */
  private parseProxy(proxyUrl: string): { server: string, username?: string, password?: string, host: string, port: string } {
    const u = new URL(proxyUrl);
    const port = u.port || '80';
    return {
      server: `http://${u.hostname}:${port}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      host: u.hostname,
      port
    };
  }

  /**
   * Generate a song based on the prompt.
   * @param prompt The text prompt to generate audio from.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @returns
   */
  public async generate(
    prompt: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false,
    persona_id?: string
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const startTime = Date.now();
    const audios = await this.generateSongs(
      prompt,
      false,
      undefined,
      undefined,
      make_instrumental,
      model,
      wait_audio,
      undefined,
      undefined,
      undefined,
      undefined,
      persona_id
    );
    const costTime = Date.now() - startTime;
    logger.info('Generate Response:\n' + JSON.stringify(audios, null, 2));
    logger.info('Cost time: ' + costTime);
    return audios;
  }

  /**
   * Calls the concatenate endpoint for a clip to generate the whole song.
   * @param clip_id The ID of the audio clip to concatenate.
   * @returns A promise that resolves to an AudioInfo object representing the concatenated audio.
   * @throws Error if the response status is not 200.
   */
  public async concatenate(clip_id: string): Promise<AudioInfo> {
    await this.keepAlive(false);
    const payload: any = { clip_id: clip_id };

    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/concat/v2/`,
      payload,
      {
        timeout: 10000 // 10 seconds timeout
      }
    );
    if (response.status !== 200) {
      throw new Error('Error response:' + response.statusText);
    }
    return response.data;
  }

  /**
   * Generates custom audio based on provided parameters.
   *
   * @param prompt The text prompt to generate audio from.
   * @param tags Tags to categorize the generated audio.
   * @param title The title for the generated audio.
   * @param make_instrumental Indicates if the generated audio should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @param negative_tags Negative tags that should not be included in the generated audio.
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated audios.
   */
  public async custom_generate(
    prompt: string,
    tags: string,
    title: string,
    make_instrumental: boolean = false,
    model?: string,
    wait_audio: boolean = false,
    negative_tags?: string,
    persona_id?: string
  ): Promise<AudioInfo[]> {
    const startTime = Date.now();
    const audios = await this.generateSongs(
      prompt,
      true,
      tags,
      title,
      make_instrumental,
      model,
      wait_audio,
      negative_tags,
      undefined,
      undefined,
      undefined,
      persona_id
    );
    const costTime = Date.now() - startTime;
    logger.info(
      'Custom Generate Response:\n' + JSON.stringify(audios, null, 2)
    );
    logger.info('Cost time: ' + costTime);
    return audios;
  }

  /**
   * Generates songs based on the provided parameters.
   *
   * @param prompt The text prompt to generate songs from.
   * @param isCustom Indicates if the generation should consider custom parameters like tags and title.
   * @param tags Optional tags to categorize the song, used only if isCustom is true.
   * @param title Optional title for the song, used only if isCustom is true.
   * @param make_instrumental Indicates if the generated song should be instrumental.
   * @param wait_audio Indicates if the method should wait for the audio file to be fully generated before returning.
   * @param negative_tags Negative tags that should not be included in the generated audio.
   * @param task Optional indication of what to do. Enter 'extend' if extending an audio, otherwise specify null.
   * @param continue_clip_id 
   * @returns A promise that resolves to an array of AudioInfo objects representing the generated songs.
   */
  private async generateSongs(
    prompt: string,
    isCustom: boolean,
    tags?: string,
    title?: string,
    make_instrumental?: boolean,
    model?: string,
    wait_audio: boolean = false,
    negative_tags?: string,
    task?: string,
    continue_clip_id?: string,
    continue_at?: number,
    persona_id?: string
  ): Promise<AudioInfo[]> {
    await this.keepAlive();
    let clips: any[];
    if (await this.captchaRequired()) {
      // Flagged account: run the whole generation inside the real browser page.
      // getCaptcha fires the actual generate POST in-page and returns its raw
      // 200 response body.
      const rawBody = await this.getCaptcha(prompt, isCustom, tags, title, make_instrumental, model, negative_tags, persona_id);
      clips = JSON.parse(rawBody!).clips;
    } else {
      const payload: any = {
        make_instrumental: make_instrumental,
        mv: model || DEFAULT_MODEL,
        prompt: '',
        generation_type: 'TEXT',
        continue_at: continue_at,
        continue_clip_id: continue_clip_id,
        task: task,
        token: null
      };
      if (persona_id) {
        Object.assign(payload, await this.buildPersonaFields(persona_id, task));
        payload.metadata = { ...(payload.metadata || {}), is_remix: true };
      }
      if (isCustom) {
        payload.tags = tags;
        payload.title = title;
        payload.negative_tags = negative_tags;
        payload.prompt = prompt;
      } else {
        payload.gpt_description_prompt = prompt;
      }
      logger.info(
        'generateSongs payload:\n' +
          JSON.stringify(
            {
              prompt: prompt,
              isCustom: isCustom,
              tags: tags,
              title: title,
              make_instrumental: make_instrumental,
              wait_audio: wait_audio,
              negative_tags: negative_tags,
              payload: payload
            },
            null,
            2
          )
      );
      const response = await this.client.post(
        `${SunoApi.BASE_URL}/api/generate/v2-web/`,
        payload,
        {
          timeout: 10000 // 10 seconds timeout
        }
      );
      if (response.status !== 200) {
        throw new Error('Error response:' + response.statusText);
      }
      clips = response.data.clips;
    }
    const songIds = clips.map((audio: any) => audio.id);
    //Want to wait for music file generation
    if (wait_audio) {
      const startTime = Date.now();
      let lastResponse: AudioInfo[] = [];
      await sleep(5, 5);
      while (Date.now() - startTime < 100000) {
        const response = await this.get(songIds);
        const allCompleted = response.every(
          (audio) => audio.status === 'streaming' || audio.status === 'complete'
        );
        const allError = response.every((audio) => audio.status === 'error');
        if (allCompleted || allError) {
          return response;
        }
        lastResponse = response;
        await sleep(3, 6);
        await this.keepAlive(true);
      }
      return lastResponse;
    } else {
      return clips.map((audio: any) => ({
        id: audio.id,
        title: audio.title,
        image_url: audio.image_url,
        lyric: audio.metadata.prompt,
        audio_url: audio.audio_url,
        video_url: audio.video_url,
        created_at: audio.created_at,
        model_name: audio.model_name,
        status: audio.status,
        gpt_description_prompt: audio.metadata.gpt_description_prompt,
        prompt: audio.metadata.prompt,
        type: audio.metadata.type,
        tags: audio.metadata.tags,
        negative_tags: audio.metadata.negative_tags,
        duration: audio.metadata.duration
      }));
    }
  }

  /**
   * Generates lyrics based on a given prompt.
   * @param prompt The prompt for generating lyrics.
   * @returns The generated lyrics text.
   */
  public async generateLyrics(prompt: string): Promise<string> {
    await this.keepAlive(false);
    // Initiate lyrics generation
    const generateResponse = await this.client.post(
      `${SunoApi.BASE_URL}/api/generate/lyrics/`,
      { prompt }
    );
    const generateId = generateResponse.data.id;

    // Poll for lyrics completion
    let lyricsResponse = await this.client.get(
      `${SunoApi.BASE_URL}/api/generate/lyrics/${generateId}`
    );
    while (lyricsResponse?.data?.status !== 'complete') {
      await sleep(2); // Wait for 2 seconds before polling again
      lyricsResponse = await this.client.get(
        `${SunoApi.BASE_URL}/api/generate/lyrics/${generateId}`
      );
    }

    // Return the generated lyrics text
    return lyricsResponse.data;
  }

  /**
   * Extends an existing audio clip by generating additional content based on the provided prompt.
   *
   * @param audioId The ID of the audio clip to extend.
   * @param prompt The prompt for generating additional content.
   * @param continueAt Extend a new clip from a song at mm:ss(e.g. 00:30). Default extends from the end of the song.
   * @param tags Style of Music.
   * @param title Title of the song.
   * @returns A promise that resolves to an AudioInfo object representing the extended audio clip.
   */
  public async extendAudio(
    audioId: string,
    prompt: string = '',
    continueAt: number,
    tags: string = '',
    negative_tags: string = '',
    title: string = '',
    model?: string,
    wait_audio?: boolean
  ): Promise<AudioInfo[]> {
    return this.generateSongs(prompt, true, tags, title, false, model, wait_audio, negative_tags, 'extend', audioId, continueAt);
  }

  /**
   * Generate stems for a song.
   * @param song_id The ID of the song to generate stems for.
   * @returns A promise that resolves to an AudioInfo object representing the generated stems.
   */
  public async generateStems(song_id: string): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/edit/stems/${song_id}`, {}
    );

    console.log('generateStems response:\n', response?.data);
    return response.data.clips.map((clip: any) => ({
      id: clip.id,
      status: clip.status,
      created_at: clip.created_at,
      title: clip.title,
      stem_from_id: clip.metadata.stem_from_id,
      duration: clip.metadata.duration
    }));
  }


  /**
   * Get the lyric alignment for a song.
   * @param song_id The ID of the song to get the lyric alignment for.
   * @returns A promise that resolves to an object containing the lyric alignment.
   */
  public async getLyricAlignment(song_id: string): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(`${SunoApi.BASE_URL}/api/gen/${song_id}/aligned_lyrics/v2/`);

    console.log(`getLyricAlignment ~ response:`, response.data);
    return response.data?.aligned_words.map((transcribedWord: any) => ({
      word: transcribedWord.word,
      start_s: transcribedWord.start_s,
      end_s: transcribedWord.end_s,
      success: transcribedWord.success,
      p_align: transcribedWord.p_align
    }));
  }

  /**
   * Processes the lyrics (prompt) from the audio metadata into a more readable format.
   * @param prompt The original lyrics text.
   * @returns The processed lyrics text.
   */
  private parseLyrics(prompt: string): string {
    // Assuming the original lyrics are separated by a specific delimiter (e.g., newline), we can convert it into a more readable format.
    // The implementation here can be adjusted according to the actual lyrics format.
    // For example, if the lyrics exist as continuous text, it might be necessary to split them based on specific markers (such as periods, commas, etc.).
    // The following implementation assumes that the lyrics are already separated by newlines.

    // Split the lyrics using newline and ensure to remove empty lines.
    const lines = prompt.split('\n').filter((line) => line.trim() !== '');

    // Reassemble the processed lyrics lines into a single string, separated by newlines between each line.
    // Additional formatting logic can be added here, such as adding specific markers or handling special lines.
    return lines.join('\n');
  }

  /**
   * Retrieves audio information for the given song IDs.
   * @param songIds An optional array of song IDs to retrieve information for.
   * @param page An optional page number to retrieve audio information from.
   * @returns A promise that resolves to an array of AudioInfo objects.
   */
  public async get(
    songIds?: string[],
    page?: string | null
  ): Promise<AudioInfo[]> {
    await this.keepAlive(false);
    let url = new URL(`${SunoApi.BASE_URL}/api/feed/v2`);
    if (songIds) {
      url.searchParams.append('ids', songIds.join(','));
    }
    if (page) {
      url.searchParams.append('page', page);
    }
    logger.info('Get audio status: ' + url.href);
    const response = await this.client.get(url.href, {
      // 10 seconds timeout
      timeout: 10000
    });

    const audios = response.data.clips;

    return audios.map((audio: any) => ({
      id: audio.id,
      title: audio.title,
      image_url: audio.image_url,
      lyric: audio.metadata.prompt
        ? this.parseLyrics(audio.metadata.prompt)
        : '',
      audio_url: audio.audio_url,
      video_url: audio.video_url,
      created_at: audio.created_at,
      model_name: audio.model_name,
      status: audio.status,
      gpt_description_prompt: audio.metadata.gpt_description_prompt,
      prompt: audio.metadata.prompt,
      type: audio.metadata.type,
      tags: audio.metadata.tags,
      duration: audio.metadata.duration,
      error_message: audio.metadata.error_message,
      media_url: (audio.media_urls || []).find((m: any) => (m.content_type || '').startsWith('audio') || (m.url || '').includes('cloudfront'))?.url || ''
    }));
  }

  /**
   * Retrieves information for a specific audio clip.
   * @param clipId The ID of the audio clip to retrieve information for.
   * @returns A promise that resolves to an object containing the audio clip information.
   */
  public async getClip(clipId: string): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/clip/${clipId}`
    );
    return response.data;
  }

  public async get_credits(): Promise<object> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/billing/info/`
    );
    return {
      credits_left: response.data.total_credits_left,
      period: response.data.period,
      monthly_limit: response.data.monthly_limit,
      monthly_usage: response.data.monthly_usage
    };
  }

  /**
   * Fetches a persona record, including the persona_type the generate payload depends on.
   * @param personaId The persona ID.
   */
  public async getPersona(personaId: string): Promise<any> {
    await this.keepAlive(false);
    const response = await this.client.get(
      `${SunoApi.BASE_URL}/api/persona/get-persona/${personaId}/`,
      { timeout: 10000 }
    );
    if (response.status !== 200) {
      throw new Error('Error response: ' + response.statusText);
    }
    return response.data;
  }

  /**
   * Builds the generate-payload fields that actually apply a persona's voice.
   *
   * Sending `persona_id` on its own is NOT enough: the endpoint accepts the request, bills
   * the credits and returns clips with no persona attached at all. Suno's own web client
   * treats a persona as a *reference*, which means the payload must also carry the task the
   * reference implies (`vox` for a vox persona, `artist_consistency` for a legacy one), the
   * source clip the voice is taken from, and override_fields so our lyrics and tags win over
   * the root clip's. This mirrors getGeneratePayload in the web client.
   *
   * @param persona_id The persona to sing the song.
   * @returns The payload fragment to merge into a generate request.
   */
  private async buildPersonaFields(persona_id: string, task?: string): Promise<Record<string, any>> {
    const persona = await this.getPersona(persona_id);
    const isVox = persona?.persona_type === 'vox';
    const rootClipId = persona?.root_clip_id;

    // A vox persona can legitimately have no shareable root clip; any other persona without
    // one cannot be applied at all, and Suno would silently ignore it rather than say so.
    if (!isValidClipId(rootClipId) && !isVox) {
      throw new Error(
        'Persona ' + persona_id + ' has no usable root clip (' + rootClipId + ') — its source song is private or deleted, so its voice cannot be applied.'
      );
    }

    // The task encodes both the persona flavour and whatever else the request is doing;
    // extending an existing clip with a persona is its own task, not a persona-only one.
    const personaTask = task === 'extend'
      ? (isVox ? 'vox_extend' : 'artist_extend')
      : (isVox ? 'vox' : 'artist_consistency');

    const fields: Record<string, any> = {
      persona_id,
      task: personaTask,
      artist_start_s: null,
      artist_end_s: null,
      // our prompt and tags must beat the ones inherited from the persona's root clip
      override_fields: ['prompt', 'tags']
    };
    if (isValidClipId(rootClipId)) {
      fields.artist_clip_id = rootClipId;
    }
    logger.info('Applying persona ' + persona_id + ' as task=' + fields.task + ' artist_clip_id=' + (fields.artist_clip_id || '(none)'));
    return fields;
  }

  public async getPersonaPaginated(personaId: string, page: number = 1): Promise<PersonaResponse> {
    await this.keepAlive(false);
    
    const url = `${SunoApi.BASE_URL}/api/persona/get-persona-paginated/${personaId}/?page=${page}`;
    
    logger.info(`Fetching persona data: ${url}`);
    
    const response = await this.client.get(url, {
      timeout: 10000 // 10 seconds timeout
    });

    if (response.status !== 200) {
      throw new Error('Error response: ' + response.statusText);
    }

    return response.data;
  }

  /**
   * Creates a persona (voice) from a completed clip owned by the account.
   * @param root_clip_id The clip ID to derive the persona from.
   * @param name Display name for the persona.
   * @param description Optional description.
   * @param is_public Whether the persona is public. Default false.
   * @param user_input_styles Optional style description.
   * @returns The created persona object (includes id for use as persona_id in generate).
   */
  public async createPersona(
    root_clip_id: string,
    name: string,
    description?: string,
    is_public: boolean = false,
    user_input_styles?: string
  ): Promise<any> {
    await this.keepAlive(false);

    const payload: any = {
      root_clip_id,
      clips: [root_clip_id],
      name,
      description: description || '',
      is_public
    };
    if (user_input_styles) {
      payload.user_input_styles = user_input_styles;
    }

    logger.info('createPersona payload:\n' + JSON.stringify(payload, null, 2));

    const response = await this.client.post(
      `${SunoApi.BASE_URL}/api/persona/create/`,
      payload,
      { timeout: 30000 }
    );

    if (response.status !== 200) {
      throw new Error('Error response: ' + response.statusText);
    }
    return response.data;
  }

  /**
   * Deletes a persona.
   * NOTE: Suno's internal API is undocumented; endpoint variants are tried in order.
   * @param personaId The persona ID to delete.
   */
  public async deletePersona(personaId: string): Promise<any> {
    await this.keepAlive(false);

    const variants = [
      { method: 'post', url: `${SunoApi.BASE_URL}/api/persona/delete/${personaId}/` },
      { method: 'delete', url: `${SunoApi.BASE_URL}/api/persona/delete/${personaId}/` },
      { method: 'delete', url: `${SunoApi.BASE_URL}/api/persona/${personaId}/` },
      { method: 'post', url: `${SunoApi.BASE_URL}/api/persona/${personaId}/delete/` },
    ];

    let lastError: any;
    for (const variant of variants) {
      try {
        const response = await this.client.request({
          method: variant.method,
          url: variant.url,
          timeout: 10000
        });
        if (response.status === 200) return response.data;
        lastError = new Error('Error response: ' + response.statusText);
      } catch (err: any) {
        lastError = err;
        if (err.response?.status === 404) continue;
        throw err;
      }
    }
    throw lastError;
  }

  /**
   * Trashes or restores one or more clips in the Suno account/library.
   * Route + body verified live: `POST /api/gen/trash` with
   * `{"clip_ids": [...], "trash": boolean}` → `{"ids": [...], "is_trashed": boolean}`.
   * The older `/api/feed/trash` + `{"ids": [...]}` variant is kept as fallback.
   * @param clipIds One or more clip IDs to trash/restore.
   * @param trash true to move clips to trash (delete), false to restore them.
   */
  public async deleteClips(clipIds: string[], trash: boolean = true): Promise<any> {
    await this.keepAlive(false);

    const ids = clipIds.filter(Boolean);
    if (!ids.length) {
      throw new Error('deleteClips: no clip IDs provided');
    }

    const variants: Array<{ method: string; url: string; body?: any }> = [
      { method: 'post', url: `${SunoApi.BASE_URL}/api/gen/trash`, body: { clip_ids: ids, trash } },
      { method: 'post', url: `${SunoApi.BASE_URL}/api/feed/trash`, body: { ids, trash } }
    ];

    let lastError: any;
    for (const variant of variants) {
      try {
        const response = await this.client.request({
          method: variant.method,
          url: variant.url,
          data: variant.body,
          timeout: 10000
        });
        if (response.status === 200) return response.data;
        lastError = new Error('Error response: ' + response.statusText);
      } catch (err: any) {
        lastError = err;
        if (err.response?.status === 404 || err.response?.status === 405) continue;
        throw err;
      }
    }
    throw lastError;
  }

  /**
   * Fetches a clip's encrypted CDN media and returns it decrypted (raw MP4/Opus bytes).
   * Scheme (reverse-engineered from suno.com web player, verified live):
   *   1. POST /api/mango/rights {content_params:{content_id, content_type:'clip'}} -> {key, iv} (base64-wrapped AES-GCM)
   *   2. userKey = SHA-256(<JWT>)
   *   3. content key/iv = AES-256-GCM decrypt of wrapped payload (iv=payload[0:12], aad=clip id, tag=payload[-16:])
   *   4. media = AES-128-CTR with 16-byte counter block = decoded iv (big-endian incrementing)
   */
  public async decryptClipMedia(clipId: string): Promise<Buffer> {
    await this.keepAlive(false);

    const token = this.currentToken;
    if (!token) throw new Error('decryptClipMedia: no auth token available');

    const rightsResp = await this.client.post(`${SunoApi.BASE_URL}/api/mango/rights`, {
      content_params: { content_id: clipId, content_type: 'clip' }
    }, { timeout: 15000 });
    const rights = rightsResp.data;
    if (!rights?.key || !rights?.iv) throw new Error('decryptClipMedia: rights response missing key/iv');

    const userKey = crypto.createHash('sha256').update(token).digest();

    const unwrap = (wrapB64: string): Buffer => {
      const payload = Buffer.from(wrapB64, 'base64');
      const iv = payload.subarray(0, 12);
      const ct = payload.subarray(12);
      const tag = ct.subarray(ct.length - 16);
      const body = ct.subarray(0, ct.length - 16);
      const d = crypto.createDecipheriv('aes-256-gcm', userKey, iv, { authTagLength: 16 });
      d.setAAD(Buffer.from(clipId));
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]);
    };

    const key = unwrap(rights.key);
    const iv = unwrap(rights.iv);
    if (key.length !== 16) throw new Error('decryptClipMedia: unexpected content key length ' + key.length);

    // The encrypted media comes off CloudFront, a public CDN GET with no Suno session
    // semantics. Routing those bytes through the Proxidize proxy made them 504
    // ("upstream proxy refused the connection: upstream_timeout") for 30-60s at a time,
    // which is what broke preview building for every song. The proxy exists for
    // suno.com API calls, where captcha token + IP + session are validated together;
    // direct fetch of the media is measured at well under a second.
    const mediaResp = await axios.get(
      `https://d2lwuy8qc234o3.cloudfront.net/1/clip/${clipId}.m4a`,
      { responseType: 'stream', timeout: 60000 }
    );
    const enc = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      mediaResp.data.on('data', (c: Buffer) => chunks.push(c));
      mediaResp.data.on('end', () => resolve(Buffer.concat(chunks)));
      mediaResp.data.on('error', reject);
    });

    const out = Buffer.alloc(enc.length);
    const BLOCKS_PER_CHUNK = 4096;
    let done = 0;
    let blockIdx = 0n;
    while (done < enc.length) {
      const chunk = Math.min(16 * BLOCKS_PER_CHUNK, enc.length - done);
      const ctr = Buffer.from(iv);
      let n = 0n;
      for (let i = 0; i < 16; i++) n = (n << 8n) | BigInt(ctr[i]);
      n += blockIdx;
      for (let i = 15; i >= 0; i--) { ctr[i] = Number(n & 255n); n >>= 8n; }
      const d = crypto.createDecipheriv('aes-128-ctr', key, ctr);
      d.update(enc.subarray(done, done + chunk)).copy(out, done);
      done += chunk;
      blockIdx += BigInt(BLOCKS_PER_CHUNK);
    }
    return out;
  }

  /**
   * Returns the URL of Suno's ORIGINAL WAV file for a clip (no transcoding).
   * Flow reverse-engineered from the suno.com desktop "Download → WAV" flow:
   *   1. POST /api/billing/clips/{id}/download/ — charges one download credit
   *      (idempotent when the WAV is already cached server-side)
   *   2. POST /api/gen/{id}/convert_wav/ — queues the server-side conversion
   *      (idempotent; skips if already converted)
   *   3. Poll GET /api/gen/{id}/wav_file/ → { wav_file_url }
   * NOTE: WAV is a paid-plan download and consumes a download credit per clip.
   */
  public async getWavFileUrl(clipId: string, timeoutSeconds: number = 120, pollSeconds: number = 3): Promise<string> {
    await this.keepAlive(false);

    try {
      await this.client.post(
        `${SunoApi.BASE_URL}/api/billing/clips/${clipId}/download/`,
        {},
        { timeout: 15000 }
      );
    } catch (err: any) {
      // Non-fatal: an already-charged/available WAV may reject the billing call.
      logger.warn(`billing/clips/${clipId}/download/ -> ${err?.response?.status || err?.message}`);
    }

    try {
      await this.client.post(
        `${SunoApi.BASE_URL}/api/gen/${clipId}/convert_wav/`,
        {},
        { timeout: 15000 }
      );
    } catch (err: any) {
      logger.warn(`gen/${clipId}/convert_wav/ -> ${err?.response?.status || err?.message}`);
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    let lastError: any = null;
    while (Date.now() < deadline) {
      try {
        const resp = await this.client.get(
          `${SunoApi.BASE_URL}/api/gen/${clipId}/wav_file/`,
          { timeout: 15000 }
        );
        const url = resp.data?.wav_file_url;
        if (url) return url;
      } catch (err: any) {
        lastError = err;
        if (err?.response?.status === 401 || err?.response?.status === 403) throw err;
      }
      await sleep(pollSeconds, pollSeconds);
    }
    throw new Error(
      `WAV conversion for clip ${clipId} did not complete within ${timeoutSeconds}s` +
      (lastError ? ` (last error: ${lastError?.response?.status || lastError?.message})` : '')
    );
  }
}

export const sunoApi = async (cookie?: string) => {
  const resolvedCookie = cookie && cookie.includes('__client') ? cookie : process.env.SUNO_COOKIE; // Check for bad `Cookie` header (It's too expensive to actually parse the cookies *here*)
  if (!resolvedCookie) {
    logger.info('No cookie provided! Aborting...\nPlease provide a cookie either in the .env file or in the Cookie header of your request.')
    throw new Error('Please provide a cookie either in the .env file or in the Cookie header of your request.');
  }

  // Check if the instance for this cookie already exists in the cache
  const cachedInstance = cache.get(resolvedCookie);
  if (cachedInstance)
    return cachedInstance;

  // If not, create a new instance and initialize it
  const instance = await new SunoApi(resolvedCookie).init();
  // Cache the initialized instance
  cache.set(resolvedCookie, instance);

  return instance;
};