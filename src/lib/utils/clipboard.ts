export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the hidden textarea path below.
  }

  if (copyWithHiddenTextarea(text)) return true;

  return copyWithTauri(text);
}

async function copyWithTauri(text: string): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('copy_to_clipboard', { text });
    return true;
  } catch {
    return false;
  }
}

function copyWithHiddenTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';

  try {
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
