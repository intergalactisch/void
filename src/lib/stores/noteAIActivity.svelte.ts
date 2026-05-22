import type {
  NoteAIActivity,
  NoteAIActivityItem,
  NoteAIActivityService,
} from '$lib/ports/inbound';

class NoteAIActivityStore {
  private service: NoteAIActivityService | null = null;

  activity = $state<NoteAIActivity | null>(null);
  activePath = $state<string | null>(null);
  selectedItemId = $state<string | null>(null);
  loading = $state(false);
  error = $state<Error | null>(null);

  init(service: NoteAIActivityService): void {
    this.service = service;
  }

  async loadForDocument(notePath: string | null): Promise<void> {
    this.activePath = notePath;
    if (!this.service || !notePath) {
      this.activity = null;
      this.selectedItemId = null;
      return;
    }

    this.loading = true;
    this.error = null;
    const result = await this.service.loadForNote(notePath);
    if (result.ok) {
      this.activity = result.value;
      this.selectedItemId = this.resolveSelectedItemId(result.value.items);
    } else {
      this.activity = null;
      this.selectedItemId = null;
      this.error = result.error;
    }
    this.loading = false;
  }

  async refresh(): Promise<void> {
    await this.loadForDocument(this.activePath);
  }

  selectItem(id: string): void {
    this.selectedItemId = id;
  }

  get items(): NoteAIActivityItem[] {
    return this.activity?.items ?? [];
  }

  get selectedItem(): NoteAIActivityItem | null {
    return this.items.find((item) => item.id === this.selectedItemId) ?? this.items[0] ?? null;
  }

  destroy(): void {
    this.service = null;
    this.activity = null;
    this.activePath = null;
    this.selectedItemId = null;
    this.loading = false;
    this.error = null;
  }

  private resolveSelectedItemId(items: NoteAIActivityItem[]): string | null {
    if (this.selectedItemId && items.some((item) => item.id === this.selectedItemId)) {
      return this.selectedItemId;
    }
    return items[0]?.id ?? null;
  }
}

export const noteAIActivityStore = new NoteAIActivityStore();
