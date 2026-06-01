<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { Calendar, Check, ChevronLeft, ChevronRight, X } from '@lucide/svelte';
  import {
    DATE_PICKER_RANGE_PRESETS,
    DATE_PICKER_WEEKDAY_LABELS,
    addDaysLocal,
    addMonthsLocal,
    buildCalendarGrid,
    formatDateInputLocal,
    formatDatePickerDisplay,
    formatMonthTitle,
    formatRangeDisplay,
    isDateInRange,
    normalizeDateRange,
    parseDateInputLocal,
    rangePresetLabel,
    resolveRangePreset,
    shortcutDateInput,
    startOfLocalDay,
    type DatePickerMode,
    type DatePickerRangeChange,
    type DatePickerRangePreset,
    type DatePickerRangeValue,
  } from './datePicker';

  type SingleChange = (value: string) => void | Promise<void>;
  type RangeChange = (value: DatePickerRangeChange) => void | Promise<void>;

  interface Props {
    mode?: DatePickerMode;
    value?: string | DatePickerRangeValue;
    preset?: DatePickerRangePreset;
    label: string;
    placeholder?: string;
    disabled?: boolean;
    allowClear?: boolean;
    name?: string;
    class?: string;
    onChange?: SingleChange | RangeChange;
  }

  let {
    mode = 'single',
    value = '',
    preset = 'any',
    label,
    placeholder = 'Pick date',
    disabled = false,
    allowClear = true,
    name,
    class: className = '',
    onChange,
  }: Props = $props();

  let root = $state<HTMLSpanElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  let panelReady = $state(false);
  let panelStyle = $state('');
  let viewDate = $state(startOfLocalDay(new Date()));
  let focusedValue = $state(formatDateInputLocal(startOfLocalDay(new Date())));
  let pendingRangeStart = $state<string | null>(null);

  const isRangeMode = $derived(mode === 'range');
  const singleValue = $derived(typeof value === 'string' ? value : '');
  const rangeValue = $derived(
    typeof value === 'object' && value !== null
      ? normalizeDateRange(value)
      : { from: '', to: '' },
  );
  const activePreset = $derived(isRangeMode ? preset : 'custom');
  const selectedRange = $derived(
    activePreset === 'custom'
      ? rangeValue
      : normalizeDateRange(resolveRangePreset(activePreset)),
  );
  const calendarDays = $derived(buildCalendarGrid(viewDate));
  const monthTitle = $derived(formatMonthTitle(viewDate));
  const displayLabel = $derived.by(() => {
    if (isRangeMode) {
      const text = formatRangeDisplay(rangeValue, activePreset);
      return text === 'Any date' && placeholder ? placeholder : text;
    }
    return singleValue ? formatDatePickerDisplay(singleValue) : placeholder;
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);

    return {
      destroy() {
        node.remove();
      },
    };
  }

  function containsDatePickerNode(node: Node | null): boolean {
    return !!node && (!!root?.contains(node) || !!panel?.contains(node));
  }

  async function openPicker() {
    if (disabled) return;
    if (!open) {
      syncFocusFromValue();
      open = true;
      await tick();
      await repositionPanel();
      focusDay(focusedValue);
      return;
    }
    closePicker({ restoreFocus: true });
  }

  function closePicker(options: { restoreFocus?: boolean } = {}) {
    open = false;
    panelReady = false;
    panelStyle = '';
    pendingRangeStart = null;
    if (options.restoreFocus) requestAnimationFrame(() => trigger?.focus());
  }

  function syncFocusFromValue() {
    const initial = isRangeMode
      ? rangeValue.from || rangeValue.to || shortcutDateInput('today')
      : singleValue || shortcutDateInput('today');
    const parsed = parseDateInputLocal(initial) ?? startOfLocalDay(new Date());
    focusedValue = formatDateInputLocal(parsed);
    viewDate = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  }

  async function repositionPanel() {
    if (!open || !trigger || !panel || typeof window === 'undefined') return;
    await tick();
    if (!panel || !trigger) return;

    const margin = 12;
    const gap = 8;
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = Math.min(panelRect.width || 316, window.innerWidth - margin * 2);
    const panelHeight = Math.min(panelRect.height || 380, window.innerHeight - margin * 2);
    const spaceBelow = window.innerHeight - triggerRect.bottom - gap - margin;
    const spaceAbove = triggerRect.top - gap - margin;
    const placeAbove = spaceBelow < panelHeight && spaceAbove > spaceBelow;
    const rawTop = placeAbove ? triggerRect.top - gap - panelHeight : triggerRect.bottom + gap;
    const rawLeft = triggerRect.left;
    const left = Math.max(margin, Math.min(rawLeft, window.innerWidth - margin - panelWidth));
    const top = Math.max(margin, Math.min(rawTop, window.innerHeight - margin - panelHeight));

    panelStyle = [
      `--date-picker-left: ${Math.round(left)}px`,
      `--date-picker-top: ${Math.round(top)}px`,
      `--date-picker-max-height: ${Math.round(window.innerHeight - margin * 2)}px`,
    ].join('; ');
    panelReady = true;
  }

  function emitSingle(next: string) {
    (onChange as SingleChange | undefined)?.(next);
  }

  function emitRange(next: DatePickerRangeChange) {
    (onChange as RangeChange | undefined)?.(next);
  }

  function selectSingleDate(next: string) {
    emitSingle(next);
    closePicker({ restoreFocus: true });
  }

  function clearSingleDate() {
    emitSingle('');
    closePicker({ restoreFocus: true });
  }

  function selectRangeDate(next: string) {
    focusedValue = next;

    if (!pendingRangeStart) {
      pendingRangeStart = next;
      emitRange({ from: next, to: '', preset: 'custom' });
      return;
    }

    const normalized = normalizeDateRange({ from: pendingRangeStart, to: next });
    emitRange({ ...normalized, preset: 'custom' });
    pendingRangeStart = null;
    closePicker({ restoreFocus: true });
  }

  function selectDay(next: string) {
    if (isRangeMode) selectRangeDate(next);
    else selectSingleDate(next);
  }

  function selectShortcut(shortcut: 'today' | 'tomorrow' | 'nextWeek') {
    selectSingleDate(shortcutDateInput(shortcut));
  }

  function selectPreset(nextPreset: DatePickerRangePreset) {
    emitRange(resolveRangePreset(nextPreset));
    pendingRangeStart = null;
    if (nextPreset !== 'custom') closePicker({ restoreFocus: true });
  }

  function moveMonth(months: number) {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + months, 1);
  }

  async function moveFocus(nextDate: Date) {
    focusedValue = formatDateInputLocal(nextDate);
    viewDate = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
    await tick();
    focusDay(focusedValue);
    await repositionPanel();
  }

  function focusDay(valueToFocus: string) {
    panel
      ?.querySelector<HTMLButtonElement>(`button[data-date="${valueToFocus}"]`)
      ?.focus();
  }

  function handleDayKeydown(event: KeyboardEvent) {
    const current = parseDateInputLocal(focusedValue) ?? startOfLocalDay(new Date());
    let next: Date | null = null;

    if (event.key === 'ArrowRight') next = addDaysLocal(current, 1);
    else if (event.key === 'ArrowLeft') next = addDaysLocal(current, -1);
    else if (event.key === 'ArrowDown') next = addDaysLocal(current, 7);
    else if (event.key === 'ArrowUp') next = addDaysLocal(current, -7);
    else if (event.key === 'Home') next = addDaysLocal(current, -current.getDay());
    else if (event.key === 'End') next = addDaysLocal(current, 6 - current.getDay());
    else if (event.key === 'PageUp') next = addMonthsLocal(current, -1);
    else if (event.key === 'PageDown') next = addMonthsLocal(current, 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectDay(focusedValue);
      return;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePicker({ restoreFocus: true });
      return;
    }

    if (next) {
      event.preventDefault();
      void moveFocus(next);
    }
  }

  function isSelectedDay(dayValue: string): boolean {
    if (isRangeMode) return selectedRange.from === dayValue || selectedRange.to === dayValue;
    return singleValue === dayValue;
  }

  function isRangeEdge(dayValue: string, edge: 'start' | 'end'): boolean {
    if (!isRangeMode) return false;
    return edge === 'start' ? selectedRange.from === dayValue : selectedRange.to === dayValue;
  }

  function isBetweenRange(dayValue: string): boolean {
    if (!isRangeMode) return false;
    return isDateInRange(dayValue, selectedRange) && !isSelectedDay(dayValue);
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (!open) return;
    const target = event.target;
    if (target instanceof Node && containsDatePickerNode(target)) return;
    closePicker();
  }

  function handlePanelKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePicker({ restoreFocus: true });
    }
  }

  $effect(() => {
    if (!open || typeof window === 'undefined') return;

    const reposition = () => {
      void repositionPanel();
    };

    void repositionPanel();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  });

  onMount(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
  });

  onDestroy(() => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  });
</script>

<span bind:this={root} class={['date-picker', className].filter(Boolean).join(' ')}>
  {#if name}
    {#if isRangeMode}
      <input type="hidden" name={`${name}-from`} value={rangeValue.from} />
      <input type="hidden" name={`${name}-to`} value={rangeValue.to} />
    {:else}
      <input type="hidden" {name} value={singleValue} />
    {/if}
  {/if}

  <button
    bind:this={trigger}
    type="button"
    class="date-picker-trigger"
    class:placeholder={!singleValue && (!isRangeMode || activePreset === 'any')}
    aria-label={label}
    aria-haspopup="dialog"
    aria-expanded={open}
    disabled={disabled}
    onclick={openPicker}
  >
    <Calendar size={13} strokeWidth={2} aria-hidden="true" />
    <span>{displayLabel}</span>
  </button>

  {#if open}
    <div
      use:portal
      bind:this={panel}
      class="date-picker-panel"
      class:positioned={panelReady}
      class:range-mode={isRangeMode}
      role="dialog"
      aria-label={label}
      tabindex="-1"
      style={panelStyle}
      onkeydown={handlePanelKeydown}
    >
      {#if isRangeMode}
        <div class="date-picker-presets" aria-label="Date range presets">
          {#each DATE_PICKER_RANGE_PRESETS as option (option)}
            <button
              type="button"
              class:active={activePreset === option}
              onclick={() => selectPreset(option)}
            >
              <span>{rangePresetLabel(option)}</span>
              {#if activePreset === option}<Check size={12} strokeWidth={2.2} aria-hidden="true" />{/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="date-picker-shortcuts" aria-label="Date shortcuts">
          <button type="button" onclick={() => selectShortcut('today')}>Today</button>
          <button type="button" onclick={() => selectShortcut('tomorrow')}>Tomorrow</button>
          <button type="button" onclick={() => selectShortcut('nextWeek')}>Next week</button>
          {#if allowClear}
            <button type="button" onclick={clearSingleDate}>Clear</button>
          {/if}
        </div>
      {/if}

      <div class="date-picker-calendar">
        <div class="date-picker-header">
          <button type="button" class="month-button" onclick={() => moveMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <strong>{monthTitle}</strong>
          <button type="button" class="month-button" onclick={() => moveMonth(1)} aria-label="Next month">
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        <div class="weekday-row" aria-hidden="true">
          {#each DATE_PICKER_WEEKDAY_LABELS as weekday}
            <span>{weekday}</span>
          {/each}
        </div>

        <div class="day-grid" role="grid" aria-label={monthTitle}>
          {#each calendarDays as day (day.value)}
            <button
              type="button"
              role="gridcell"
              data-date={day.value}
              tabindex={focusedValue === day.value ? 0 : -1}
              class:outside={!day.inCurrentMonth}
              class:today={day.isToday}
              class:selected={isSelectedDay(day.value)}
              class:range-start={isRangeEdge(day.value, 'start')}
              class:range-end={isRangeEdge(day.value, 'end')}
              class:range-middle={isBetweenRange(day.value)}
              class:pending={pendingRangeStart === day.value}
              aria-selected={isSelectedDay(day.value)}
              aria-label={formatDatePickerDisplay(day.value) || day.value}
              onclick={() => selectDay(day.value)}
              onfocus={() => { focusedValue = day.value; }}
              onkeydown={handleDayKeydown}
            >
              <span>{day.day}</span>
            </button>
          {/each}
        </div>
      </div>

      {#if isRangeMode}
        <div class="date-picker-footer">
          <span>
            {#if pendingRangeStart}
              Select an end date
            {:else if activePreset === 'custom' && (rangeValue.from || rangeValue.to)}
              {formatRangeDisplay(rangeValue, 'custom')}
            {:else}
              Pick a custom range
            {/if}
          </span>
          {#if allowClear}
            <button type="button" class="clear-button" onclick={() => selectPreset('any')}>
              <X size={12} strokeWidth={2.2} aria-hidden="true" />
              <span>Clear</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</span>

<style>
  .date-picker {
    display: inline-flex;
    min-width: 0;
  }

  .date-picker-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    min-height: 30px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-app);
    color: var(--text-primary);
    padding: 0 9px;
    font: inherit;
    font-size: var(--text-small);
    text-align: left;
    cursor: pointer;
  }

  .date-picker-trigger span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .date-picker-trigger.placeholder {
    color: var(--text-placeholder);
  }

  .date-picker-trigger:hover:not(:disabled),
  .date-picker-trigger[aria-expanded='true'] {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .date-picker-trigger:focus-visible {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .date-picker-trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .date-picker-panel {
    position: fixed;
    top: var(--date-picker-top, 12px);
    left: var(--date-picker-left, 12px);
    z-index: calc(var(--z-popover) + 8);
    display: grid;
    gap: 10px;
    width: min(316px, calc(100vw - 24px));
    max-height: min(440px, var(--date-picker-max-height, calc(100vh - 24px)));
    overflow: auto;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-popover);
    padding: 10px;
    opacity: 0;
    transform: translateY(-4px) scale(0.985);
  }

  .date-picker-panel.positioned {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .date-picker-panel.range-mode {
    width: min(420px, calc(100vw - 24px));
    grid-template-columns: 124px minmax(0, 1fr);
    align-items: start;
  }

  .date-picker-shortcuts,
  .date-picker-presets {
    display: flex;
    gap: 5px;
  }

  .date-picker-shortcuts {
    flex-wrap: wrap;
  }

  .date-picker-presets {
    flex-direction: column;
  }

  .date-picker-shortcuts button,
  .date-picker-presets button,
  .clear-button {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-height: 26px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-sm);
    background: var(--bg-app);
    color: var(--text-secondary);
    padding: 0 8px;
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
  }

  .date-picker-presets button {
    width: 100%;
  }

  .date-picker-shortcuts button:hover,
  .date-picker-presets button:hover,
  .date-picker-presets button.active,
  .clear-button:hover {
    border-color: var(--border-medium);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .date-picker-presets button.active {
    border-color: color-mix(in srgb, var(--accent-primary) 24%, var(--border-light));
    background: var(--accent-light);
    color: var(--accent-primary);
  }

  .date-picker-calendar {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .date-picker-header {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 28px;
    align-items: center;
    gap: 4px;
  }

  .date-picker-header strong {
    color: var(--text-primary);
    font-size: var(--text-small);
    font-weight: 650;
    text-align: center;
  }

  .month-button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .month-button:hover,
  .month-button:focus-visible {
    background: var(--bg-hover);
    color: var(--text-primary);
    outline: none;
  }

  .weekday-row,
  .day-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 3px;
  }

  .weekday-row span {
    display: grid;
    place-items: center;
    height: 18px;
    color: var(--text-tertiary);
    font-size: var(--text-micro);
    font-weight: 650;
  }

  .day-grid button {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    min-width: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-caption);
    cursor: pointer;
    outline: none;
  }

  .day-grid button:hover,
  .day-grid button:focus-visible {
    background: var(--bg-hover);
    box-shadow: inset 0 0 0 1px var(--border-medium);
  }

  .day-grid button.outside {
    color: var(--text-placeholder);
  }

  .day-grid button.today {
    color: var(--accent-primary);
    font-weight: 700;
  }

  .day-grid button.range-middle {
    background: var(--accent-light);
    color: var(--text-primary);
  }

  .day-grid button.selected,
  .day-grid button.pending {
    background: var(--accent-primary);
    color: var(--text-inverse);
    font-weight: 700;
  }

  .day-grid button.range-start {
    border-top-right-radius: var(--radius-xs);
    border-bottom-right-radius: var(--radius-xs);
  }

  .day-grid button.range-end {
    border-top-left-radius: var(--radius-xs);
    border-bottom-left-radius: var(--radius-xs);
  }

  .date-picker-footer {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-faint);
    color: var(--text-tertiary);
    font-size: var(--text-caption);
  }

  .clear-button {
    flex: 0 0 auto;
    border: 0;
    background: transparent;
    padding: 0 4px;
  }

  @media (max-width: 520px) {
    .date-picker-panel.range-mode {
      grid-template-columns: 1fr;
    }

    .date-picker-presets {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
