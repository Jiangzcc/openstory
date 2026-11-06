import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DropdownMenuCheckboxItem } from '@/ui/shadcn/dropdown-menu';
import { BaseModelSelector } from './base-model-selector';

type MenuItemProps = ComponentProps<typeof DropdownMenuCheckboxItem>;
const menu = vi.hoisted(() => {
  const items: MenuItemProps[] = [];
  return { items };
});

// Only portal primitives are mocked; the selector renders and handles selections.
vi.mock('@/ui/shadcn/dropdown-menu', () => {
  const Box = ({ children }: { children?: ReactNode }) => children;
  return {
    DropdownMenu: Box,
    DropdownMenuTrigger: Box,
    DropdownMenuContent: Box,
    DropdownMenuGroup: Box,
    DropdownMenuLabel: Box,
    DropdownMenuSeparator: () => null,
    DropdownMenuCheckboxItem: (props: MenuItemProps) => {
      menu.items.push(props);
      return <button disabled={props.disabled}>{props.children}</button>;
    },
  };
});

const unavailable = 'custom-image:disabled';
const available = 'gpt_image_2';
const other = 'flux_2_dev';
const models = [
  { id: unavailable, name: 'Disabled model', group: 'quality', disabled: true },
  { id: available, name: 'Available model', group: 'quality' },
  { id: other, name: 'Other model', group: 'quality' },
];

function renderSelector(
  selectedIds: string[],
  options: { multiSelect?: boolean; disabled?: boolean } = {}
) {
  const change = vi.fn();
  renderToStaticMarkup(
    <BaseModelSelector
      label="Image models"
      models={models}
      groupOrder={['quality']}
      selectedIds={selectedIds}
      onSelectionChange={change}
      multiSelect
      {...options}
    />
  );
  return change;
}

function toggleItem(index: number) {
  const item = menu.items[index];
  if (!item) throw new Error('Missing rendered menu item.');
  if (!item.disabled) item.onCheckedChange?.(!item.checked);
}

beforeEach(() => {
  menu.items.length = 0;
});

describe('model selector availability and removal', () => {
  it('lets a user uncheck an unavailable model while retaining another selection', () => {
    const change = renderSelector([unavailable, available]);
    expect(menu.items[0]?.disabled).toBeFalsy();
    toggleItem(0);
    expect(change).toHaveBeenCalledExactlyOnceWith([available]);
  });

  it('keeps an unselected unavailable model disabled', () => {
    const change = renderSelector([available, other]);
    expect(menu.items[0]?.disabled).toBe(true);
    toggleItem(0);
    expect(change).not.toHaveBeenCalled();
  });

  it('does not remove the last selected model, even when it is unavailable', () => {
    const change = renderSelector([unavailable]);
    expect(menu.items[0]?.disabled).toBe(true);
    toggleItem(0);
    expect(change).not.toHaveBeenCalled();
  });

  it('preserves normal multi-selection of available models', () => {
    const change = renderSelector([available, other]);
    toggleItem(1);
    expect(change).toHaveBeenCalledExactlyOnceWith([other]);
  });

  it('preserves single-selection replacement and unavailable-model blocking', () => {
    const change = renderSelector([available], { multiSelect: false });
    toggleItem(0);
    expect(change).not.toHaveBeenCalled();
    toggleItem(2);
    expect(change).toHaveBeenCalledExactlyOnceWith([other]);
  });

  it('does not change selections when the whole selector is disabled', () => {
    const change = renderSelector([unavailable, available], { disabled: true });
    toggleItem(0);
    toggleItem(2);
    expect(change).not.toHaveBeenCalled();
  });
});
