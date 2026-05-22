import type { InlineAIThreadService } from '$lib/ports/inbound/InlineAIThreadService';
import type { InlineAIThread } from '$lib/domain/entities/InlineAIThread';
import { isInlineAIThreadUnread } from '$lib/domain/entities/InlineAIThread';

class InlineAIStore {
  private service: InlineAIThreadService | null = null;
  private unsubscribe: (() => void) | null = null;

  threads = $state<InlineAIThread[]>([]);
  activePath = $state<string | null>(null);
  loading = $state(false);
  error = $state<Error | null>(null);

  get visibleThreads(): InlineAIThread[] {
    return this.threads.filter((thread) => !thread.dismissedAt);
  }

  get unreadThreads(): InlineAIThread[] {
    return this.visibleThreads.filter(isInlineAIThreadUnread);
  }

  get unreadCount(): number {
    return this.unreadThreads.length;
  }

  init(service: InlineAIThreadService): void {
    this.unsubscribe?.();
    this.service = service;
    this.unsubscribe = service.subscribe((threads) => {
      this.threads = threads;
    });
  }

  async loadForDocument(notePath: string | null): Promise<void> {
    this.activePath = notePath;
    if (!this.service || !notePath) {
      this.threads = [];
      return;
    }
    this.loading = true;
    this.error = null;
    const result = await this.service.loadForDocument(notePath);
    if (result.ok) {
      this.threads = result.value;
    } else {
      this.error = result.error;
      this.threads = [];
    }
    this.loading = false;
  }

  async accept(threadId: string): Promise<boolean> {
    if (!this.service) return false;
    const result = await this.service.acceptProposal(threadId);
    if (!result.ok) {
      this.error = result.error;
      return false;
    }
    return true;
  }

  async cancel(threadId: string): Promise<boolean> {
    if (!this.service) return false;
    const result = await this.service.cancelProposal(threadId);
    if (!result.ok) {
      this.error = result.error;
      return false;
    }
    return true;
  }

  async retry(threadId: string): Promise<boolean> {
    if (!this.service) return false;
    const result = await this.service.retryThread(threadId);
    if (!result.ok) {
      this.error = result.error;
      return false;
    }
    return true;
  }

  async followUp(threadId: string, prompt: string): Promise<boolean> {
    if (!this.service) return false;
    const result = await this.service.followUp(threadId, prompt);
    if (!result.ok) {
      this.error = result.error;
      return false;
    }
    return true;
  }

  async dismiss(threadId: string): Promise<void> {
    if (!this.service) return;
    const result = await this.service.dismissThread(threadId);
    if (!result.ok) this.error = result.error;
  }

  async markSeen(threadId: string): Promise<void> {
    if (!this.service) return;
    const result = await this.service.markSeen(threadId);
    if (!result.ok) this.error = result.error;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.service = null;
    this.threads = [];
    this.activePath = null;
    this.error = null;
  }
}

export const inlineAIStore = new InlineAIStore();
