export class YouTubeLiveChat {
  constructor(apiKeys, initialKeyIndex = 0) {
    this.apiKeys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
    this.currentKeyIndex = initialKeyIndex % this.apiKeys.length;
    this.liveChatId = null;
    this.nextPageToken = null;
    this.pollingInterval = 5000;
    this.isPolling = false;
    this.seenIds = new Set();
    this.timeoutId = null;
    this.onMessage = null; // Callback function
    this.onError = null; // Callback for errors
    this.onStatusChange = null; // Callback for status updates ('ok' | 'err')
    this.onRecovery = null; // Callback when polling recovers after errors
    this.onKeyRotate = null; // ✅ Callback to sync key index externally

    // ✅ Exponential backoff state
    this.retryCount = 0;
    this.maxRetries = 10; // Stop retrying after 10 consecutive failures
    this.baseRetryDelay = 10000; // 10 seconds base
    this.maxRetryDelay = 120000; // 2 minutes cap
    this.wasInErrorState = false; // Track error-to-recovery transitions
  }

  /**
   * Get current API Key with rotation support
   */
  get apiKey() {
    return this.apiKeys[this.currentKeyIndex];
  }

  /**
   * ✅ Rotate to next API key with wrap-around
   * Returns true if there's a different key to try, false if all keys exhausted in this cycle
   */
  rotateKey() {
    const prevIndex = this.currentKeyIndex;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    console.warn(`🔑 Rotating API Key: #${prevIndex + 1} → #${this.currentKeyIndex + 1} (of ${this.apiKeys.length})`);

    // ✅ Notify external listener to sync key index
    if (this.onKeyRotate) this.onKeyRotate(this.currentKeyIndex);

    // If we wrapped back to the starting point, all keys have been tried
    return this.currentKeyIndex !== prevIndex;
  }

  /**
   * 1. API Connection: Connect to YouTube API to get liveChatId
   */
  async fetchLiveChatId(videoId, _triedKeys = 0) {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${this.apiKey}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.error) {
        if (_triedKeys < this.apiKeys.length - 1 && this.rotateKey()) {
          return this.fetchLiveChatId(videoId, _triedKeys + 1);
        }
        throw new Error(data.error.message);
      }

      if (!data.items || data.items.length === 0) {
        throw new Error("Video not found");
      }

      const details = data.items[0].liveStreamingDetails;
      if (!details || !details.activeLiveChatId) {
        throw new Error(
          "No active live chat found (Stream might be offline or chat disabled)",
        );
      }

      this.liveChatId = details.activeLiveChatId;
      return this.liveChatId;
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  /**
   * 2. Fetching Loop: Poll messages from endpoint
   */
  async startPolling(videoId, callback) {
    if (this.isPolling) return;

    try {
      if (!this.liveChatId) {
        await this.fetchLiveChatId(videoId);
      }

      this.isPolling = true;
      this.onMessage = callback;
      this.loadChat();
    } catch (error) {
      console.error("Failed to start polling:", error);
      if (this.onError) this.onError(error);
      if (this.onStatusChange) this.onStatusChange("err");
    }
  }

  stopPolling() {
    this.isPolling = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Main Polling Loop (Renamed to loadChat as per requirements)
   */
  async loadChat(_rotationAttempts = 0) {
    if (!this.isPolling || !this.liveChatId) return;

    const url = new URL(
      "https://www.googleapis.com/youtube/v3/liveChat/messages",
    );
    url.searchParams.append("liveChatId", this.liveChatId);
    url.searchParams.append("part", "snippet,authorDetails");
    url.searchParams.append("key", this.apiKey);

    // Manage nextPageToken
    if (this.nextPageToken) {
      url.searchParams.append("pageToken", this.nextPageToken);
    }

    if (this.onStatusChange) this.onStatusChange("working");

    try {
      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.error) {
        console.error(
          "API Error during poll:",
          data.error.message,
          "Code:",
          data.error.code,
        );
        if (this.onStatusChange) this.onStatusChange("err");
        this.wasInErrorState = true;

        // ✅ Smarter Rotation Logic (with cycle limit)
        const errorCode = data.error.code;
        const shouldRotate = errorCode === 403 || errorCode === 429;

        if (shouldRotate && _rotationAttempts < this.apiKeys.length - 1) {
          this.rotateKey();
          // Retry immediately with new key
          this.loadChat(_rotationAttempts + 1);
          return;
        } else if (!shouldRotate) {
          console.warn(
            `⚠️ API Error ${errorCode}: Retrying without rotation...`,
          );
        }

        // ✅ Exponential backoff with retry limit
        this.retryCount++;
        if (this.retryCount > this.maxRetries) {
          console.error(
            `❌ Max retries (${this.maxRetries}) exceeded. Stopping polling.`,
          );
          if (this.onError)
            this.onError(
              new Error(
                `Polling stopped: ${this.maxRetries} consecutive failures`,
              ),
            );
          this.stopPolling();
          return;
        }

        const backoffDelay = Math.min(
          this.baseRetryDelay * Math.pow(2, this.retryCount - 1),
          this.maxRetryDelay,
        );
        console.warn(
          `⏳ Retry ${this.retryCount}/${this.maxRetries} in ${(backoffDelay / 1000).toFixed(0)}s...`,
        );
        this.timeoutId = setTimeout(() => this.loadChat(), backoffDelay);
        return;
      }

      // ✅ Success — reset retry count and notify recovery
      if (this.retryCount > 0 || this.wasInErrorState) {
        console.log(`✅ Polling recovered after ${this.retryCount} retries`);
        if (this.onRecovery) this.onRecovery(this.retryCount);
      }
      this.retryCount = 0;
      this.wasInErrorState = false;

      if (this.onStatusChange) this.onStatusChange("ok");

      // Update Polling Interval from API
      if (data.pollingIntervalMillis) {
        this.pollingInterval = data.pollingIntervalMillis;
      }

      // Update Next Page Token
      if (data.nextPageToken) {
        this.nextPageToken = data.nextPageToken;
      }

      // Process Messages
      if (data.items && data.items.length > 0) {
        // ✅ Sort by timestamp to ensure order
        data.items.sort((a, b) => {
          return (
            new Date(a.snippet.publishedAt).getTime() -
            new Date(b.snippet.publishedAt).getTime()
          );
        });

        data.items.forEach((item) => {
          // 3. Deduplication: Check Message ID
          if (!this.seenIds.has(item.id)) {
            this.seenIds.add(item.id);

            // ✅ Batch cleanup: remove oldest 200 when exceeding 1000
            if (this.seenIds.size > 1000) {
              const iterator = this.seenIds.values();
              for (let i = 0; i < 200; i++) {
                const oldest = iterator.next().value;
                this.seenIds.delete(oldest);
              }
            }

            // Send to callback
            if (this.onMessage) this.onMessage(item);
          }
        });
      }
    } catch (error) {
      console.error("Network error fetching chat:", error);
      if (this.onError) this.onError(error);
      if (this.onStatusChange) this.onStatusChange("err");
      this.wasInErrorState = true;

      // ✅ Exponential backoff on network errors too
      this.retryCount++;
      if (this.retryCount > this.maxRetries) {
        console.error(
          `❌ Max retries (${this.maxRetries}) exceeded. Stopping polling.`,
        );
        this.stopPolling();
        return;
      }

      const backoffDelay = Math.min(
        this.baseRetryDelay * Math.pow(2, this.retryCount - 1),
        this.maxRetryDelay,
      );
      this.timeoutId = setTimeout(() => this.loadChat(), backoffDelay);
      return;
    }

    // Schedule next poll
    if (this.isPolling) {
      this.timeoutId = setTimeout(
        () => this.loadChat(),
        Math.max(this.pollingInterval, 1000),
      );
    }
  }
}

/**
 * Extract and normalize message content into a runs array for emoji support.
 * Exported as standalone helper so any consumer (ChatProcessor, etc.) can use it.
 *
 * @param {Object} item - YouTube API liveChatMessage item
 * @returns {Array<{text?: string, emoji?: {emojiId: string, image: Object}}>}
 */
export function extractMessageRuns(item) {
  // Check if textMessageDetails exists with message runs
  if (item.snippet?.textMessageDetails?.messageText) {
    const messageText = item.snippet.textMessageDetails.messageText;

    // Case A: Simple string → wrap in a single text run
    if (typeof messageText === 'string') {
      return [{ text: messageText }];
    }

    // Case B: Array of runs (text + emojis)
    if (Array.isArray(messageText)) {
      return messageText.map(run => {
        if (run.text) {
          return { text: run.text };
        } else if (run.emoji) {
          return {
            emoji: {
              emojiId: run.emoji.emojiId,
              image: run.emoji.image
            }
          };
        }
        return { text: '' };
      });
    }
  }

  // Fallback to displayMessage
  return [{ text: item.snippet?.displayMessage || '' }];
}
