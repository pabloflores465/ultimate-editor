// AI Provider Store - manages AI configuration and chat state

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsVision: boolean;
  supportsRouter: boolean;
}

export interface AISettings {
  providers: AIProvider[];
  activeProviderId: string | null;
  routerMode: boolean;
  routerFallbackModel: string;
}

export interface ChatAttachment {
  id: string;
  type: "file" | "image";
  name: string;
  content?: string;
  mimeType?: string;
  path?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: ChatAttachment[];
  timestamp: Date;
  isStreaming?: boolean;
}

const defaultProviders: AIProvider[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    model: "openai/gpt-4o",
    supportsVision: true,
    supportsRouter: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o",
    supportsVision: true,
    supportsRouter: false,
  },
  {
    id: "custom",
    name: "Custom",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "llama3",
    supportsVision: false,
    supportsRouter: false,
  },
];

class AIStore {
  settings = $state<AISettings>({
    providers: [...defaultProviders],
    activeProviderId: "openrouter",
    routerMode: true,
    routerFallbackModel: "openai/gpt-4o",
  });

  isSettingsOpen = $state(false);

  get activeProvider(): AIProvider | null {
    return (
      this.settings.providers.find(
        (p) => p.id === this.settings.activeProviderId
      ) || null
    );
  }

  getProvider(id: string): AIProvider | null {
    return this.settings.providers.find((p) => p.id === id) || null;
  }

  updateProvider(id: string, updates: Partial<AIProvider>) {
    const idx = this.settings.providers.findIndex((p) => p.id === id);
    if (idx !== -1) {
      this.settings.providers[idx] = {
        ...this.settings.providers[idx],
        ...updates,
      };
    }
  }

  setActiveProvider(id: string) {
    this.settings.activeProviderId = id;
  }

  toggleRouterMode() {
    this.settings.routerMode = !this.settings.routerMode;
  }

  openSettings() {
    this.isSettingsOpen = true;
  }

  closeSettings() {
    this.isSettingsOpen = false;
  }

  // Chat streaming
  abortController: AbortController | null = null;

  abortStream() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async *streamChat(
    messages: Array<{
      role: "user" | "assistant" | "system";
      content: string;
      attachments?: ChatAttachment[];
    }>,
    options?: {
      onToolCall?: (toolCall: any) => void;
    }
  ): AsyncGenerator<string, void, unknown> {
    const provider = this.activeProvider;
    if (!provider) {
      throw new Error("No AI provider configured");
    }

    this.abortController = new AbortController();

    try {
      // Build messages with attachments
      const apiMessages = messages.map((msg) => {
        if (msg.attachments && msg.attachments.length > 0) {
          const content: any[] = [{ type: "text", text: msg.content }];

          for (const attachment of msg.attachments) {
            if (attachment.type === "image" && attachment.content) {
              content.push({
                type: "image_url",
                image_url: {
                  url: attachment.content, // base64 data URL
                },
              });
            } else if (attachment.type === "file" && attachment.content) {
              content.push({
                type: "text",
                text: `\n\n[File: ${attachment.name}]\n\`\`\`\n${attachment.content}\n\`\`\``,
              });
            }
          }

          return {
            role: msg.role,
            content,
          };
        }

        return {
          role: msg.role,
          content: msg.content,
        };
      });

      // Prepare request body
      const body: any = {
        model: provider.supportsRouter && this.settings.routerMode
          ? undefined
          : provider.model,
        messages: apiMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4000,
      };

      // OpenRouter specific headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      };

      if (provider.id === "openrouter") {
        headers["HTTP-Referer"] = "https://ultimate-editor.app";
        headers["X-Title"] = "Ultimate Editor";

        if (this.settings.routerMode) {
          headers["X-Title"] = "Ultimate Editor (Router)";
        }
      }

      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") return;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;

              if (delta?.content) {
                yield delta.content;
              }

              // Handle tool calls if present
              if (delta?.tool_calls && options?.onToolCall) {
                for (const toolCall of delta.tool_calls) {
                  options.onToolCall(toolCall);
                }
              }
            } catch {
              // Ignore parse errors for [DONE] or empty lines
            }
          }
        }
      }
    } finally {
      this.abortController = null;
    }
  }

  // File reading helper
  async readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
}

export const aiStore = new AIStore();
