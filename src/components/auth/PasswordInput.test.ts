// Prompt 903 — the password eye. Renders the REAL component with react-dom/server
// (no DOM needed), the same way PortfolioTable.test.ts does (Prompt AL758): this
// repo has no component-test library, and adding jsdom + @testing-library would
// be new devDependencies for one component, which the prompt rules out ("sem
// dependência nova"). Written as .ts with createElement so no JSX is needed.
//
// Four layers, because each answers a different question:
//  - markup  — what the browser is handed in each state (type, aria-label, ...);
//  - wiring  — the element tree, to prove each handler sits on the right element
//              (Enter handler on the <input>, never on the eye; the eye is a
//              type="button" that cancels mousedown so it cannot take focus);
//  - state   — the real stateful component, "clicked" N times through a
//              render-phase update;
//  - caret   — the selection is put back after a toggle, against a stand-in for
//              the field and fake timers.
// What none of them can show is a real click flipping a real DOM node and a real
// Enter keypress reaching the handler — nor what a given browser really does to
// the caret: that is checked live in the browser (dev:verify), not here.
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordInput, PasswordInputView, type PasswordInputProps } from './PasswordInput';

const base: PasswordInputProps = { autoComplete: 'new-password', value: 'Correct-Horse-9!', onChange: () => {}, placeholder: 'Password *' };

// Attributes of the first <input>/<button>/<div> in the markup, names lower-cased
// (React keeps autoComplete/autoCapitalize camel-cased in server markup, and the
// HTML parser does not care).
function attrsOf(html: string, tag: 'input' | 'button' | 'div'): Record<string, string> {
  const opening = new RegExp(`<${tag}\\b([^>]*)>`).exec(html)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const m of opening.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) out[m[1].toLowerCase()] = m[2] ?? '';
  return out;
}

const view = (over: Partial<PasswordInputProps> & { visible?: boolean } = {}) => {
  const { visible = false, ...rest } = over;
  return renderToStaticMarkup(createElement(PasswordInputView, { ...base, ...rest, visible, onToggle: () => {} }));
};

describe('PasswordInput — what the browser is given (Prompt 903 §A.1)', () => {
  it('hidden: a password field, with an eye that offers to show it', () => {
    const html = view({ visible: false });
    expect(attrsOf(html, 'input').type).toBe('password');
    const eye = attrsOf(html, 'button');
    expect(eye.type).toBe('button');
    expect(eye['aria-label']).toBe('Show password');
    expect(eye['aria-pressed']).toBe('false');
    expect(eye.title).toBe('Show password');
    expect(html).toContain('<circle');
    expect(html).not.toContain('<line');
  });

  it('visible: a text field, with an eye that offers to hide it — and the typed value is untouched', () => {
    const html = view({ visible: true });
    const input = attrsOf(html, 'input');
    expect(input.type).toBe('text');
    expect(input.value).toBe('Correct-Horse-9!');
    const eye = attrsOf(html, 'button');
    expect(eye.type).toBe('button');
    expect(eye['aria-label']).toBe('Hide password');
    expect(eye['aria-pressed']).toBe('true');
    expect(html).toContain('<line');
    expect(html).not.toContain('<circle');
  });

  it('forwards the ordinary <input> props to the <input>, and keeps layout on the wrapper', () => {
    const html = view({
      id: 'pw', name: 'password', required: true, autoComplete: 'current-password',
      className: 'rounded-xl border px-3 py-2', wrapperClassName: 'mb-4',
    });
    expect(attrsOf(html, 'input')).toMatchObject({
      id: 'pw', name: 'password', placeholder: 'Password *', value: 'Correct-Horse-9!', required: '', autocomplete: 'current-password',
    });
    const inputClasses = attrsOf(html, 'input').class.split(' ');
    expect(inputClasses).toEqual(expect.arrayContaining(['block', 'w-full', 'rounded-xl', 'border', 'px-3', 'py-2', 'pr-10']));
    // A margin on the input would push the eye off-centre; it belongs on the wrapper.
    expect(inputClasses).not.toContain('mb-4');
    expect(attrsOf(html, 'div').class.split(' ')).toEqual(expect.arrayContaining(['relative', 'mb-4']));
  });

  it('a disabled field disables the eye too', () => {
    const html = view({ disabled: true });
    expect(attrsOf(html, 'input')).toHaveProperty('disabled');
    expect(attrsOf(html, 'button')).toHaveProperty('disabled');
    expect(attrsOf(view(), 'button')).not.toHaveProperty('disabled');
  });

  it('keeps phones from capitalising or "correcting" a revealed password, unless the caller says otherwise', () => {
    expect(attrsOf(view({ visible: true }), 'input')).toMatchObject({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    expect(attrsOf(view({ autoCapitalize: 'words' }), 'input').autocapitalize).toBe('words');
  });

  it("hides the browser's own reveal control, so Edge does not draw a second eye", () => {
    expect(attrsOf(view(), 'input').class).toContain('[&amp;::-ms-reveal]:hidden');
  });
});

describe('PasswordInput — wiring (Prompt 903 §A.1: Enter submits, the eye does not)', () => {
  type Handlers = {
    onKeyDown?: (e: unknown) => void;
    onClick?: () => void;
    onMouseDown?: (e: { preventDefault: () => void }) => void;
    type?: string;
    children?: ReactElement<Handlers>[];
  };

  function parts(over: Partial<PasswordInputProps> & { onToggle?: () => void } = {}) {
    const { onToggle = () => {}, ...rest } = over;
    const root = PasswordInputView({ ...base, ...rest, visible: false, onToggle }) as ReactElement<Handlers>;
    const [input, eye] = root.props.children as ReactElement<Handlers>[];
    return { root, input, eye };
  }

  it('Enter is handled by the <input> itself — login/reset/set-password are not <form>s', () => {
    const onKeyDown = vi.fn();
    const { root, input, eye } = parts({ onKeyDown });
    expect(input.type).toBe('input');
    input.props.onKeyDown?.({ key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledWith({ key: 'Enter' });
    // …and nowhere else: not the wrapper, not the eye.
    expect(root.props.onKeyDown).toBeUndefined();
    expect(eye.props.onKeyDown).toBeUndefined();
  });

  it('the eye is a plain button: it toggles, and a type="button" cannot submit a surrounding form', () => {
    const onToggle = vi.fn();
    const onKeyDown = vi.fn();
    const { eye } = parts({ onToggle, onKeyDown });
    expect(eye.type).toBe('button');
    expect(eye.props.type).toBe('button');
    eye.props.onClick?.();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('pressing the eye does not take focus out of the field', () => {
    const { eye } = parts();
    const preventDefault = vi.fn();
    eye.props.onMouseDown?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('PasswordInput — the stateful component (Prompt 903 §C: clicking the eye toggles type and aria-label)', () => {
  // Presses the eye `clicks` times while rendering — through the very onToggle the
  // real button holds — and returns the markup React settles on. A state update
  // made during render re-renders the component, which is what lets the server
  // renderer exercise useState without a DOM.
  function afterClicks(clicks: number): string {
    let remaining = clicks;
    function Probe() {
      const el = PasswordInput(base);
      if (remaining > 0) { remaining -= 1; el.props.onToggle(); }
      return el;
    }
    return renderToStaticMarkup(createElement(Probe));
  }

  it('starts hidden', () => {
    const html = afterClicks(0);
    expect(attrsOf(html, 'input').type).toBe('password');
    expect(attrsOf(html, 'button')['aria-label']).toBe('Show password');
  });

  it('one click reveals it; a second hides it again; a third reveals it again', () => {
    const one = afterClicks(1);
    expect(attrsOf(one, 'input').type).toBe('text');
    expect(attrsOf(one, 'button')['aria-label']).toBe('Hide password');
    expect(attrsOf(one, 'button')['aria-pressed']).toBe('true');

    const two = afterClicks(2);
    expect(attrsOf(two, 'input').type).toBe('password');
    expect(attrsOf(two, 'button')['aria-label']).toBe('Show password');
    expect(attrsOf(two, 'button')['aria-pressed']).toBe('false');

    expect(attrsOf(afterClicks(3), 'input').type).toBe('text');
  });

  it('toggling never touches what was typed', () => {
    for (const clicks of [0, 1, 2, 3]) expect(attrsOf(afterClicks(clicks), 'input').value).toBe('Correct-Horse-9!');
  });
});

// Found live, not by reading: with a real mouse click Chromium drops the caret of
// the focused field to position 0 once the type has flipped (a scripted .click()
// does not), so the next keystroke would land at the START of the password. The
// field is a stand-in with the handful of members the component touches.
describe('PasswordInput — the caret survives the toggle (Prompt 903, live finding)', () => {
  type Field = {
    value: string; selectionStart: number; selectionEnd: number; selectionDirection: string;
    scrollLeft: number; scrollWidth: number; setSelectionRange: ReturnType<typeof vi.fn>;
  };
  const field = (over: Partial<Field> = {}): Field => ({
    value: 'Correct-Horse-9!', selectionStart: 5, selectionEnd: 5, selectionDirection: 'forward',
    scrollLeft: 0, scrollWidth: 400, setSelectionRange: vi.fn(), ...over,
  });

  // Presses the eye once while `f` is mounted as the input and `focused` is the
  // document's active element; timers and rAF are fake, so the test decides when
  // "the browser has settled". Returns the stand-in document, so a test can move
  // focus afterwards.
  function pressEye(f: Field, focused: unknown) {
    const doc = { activeElement: focused };
    vi.useFakeTimers();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16));
    let pressed = false;
    function Probe() {
      const el = PasswordInput(base);
      if (!pressed) { pressed = true; el.props.inputRef.current = f; el.props.onToggle(); }
      return el;
    }
    renderToStaticMarkup(createElement(Probe));
    return doc;
  }
  const browserDropsTheCaret = (f: Field) => { f.selectionStart = 0; f.selectionEnd = 0; };

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('puts the selection back once the browser has dropped it — and again on the next frame', () => {
    const f = field();
    pressEye(f, f);
    browserDropsTheCaret(f);
    expect(f.setSelectionRange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(f.setSelectionRange).toHaveBeenCalledTimes(1);
    expect(f.setSelectionRange).toHaveBeenLastCalledWith(5, 5, 'forward');
    vi.advanceTimersByTime(20);
    expect(f.setSelectionRange).toHaveBeenCalledTimes(2);
  });

  it('keeps a selected range, not just a caret', () => {
    const f = field({ selectionStart: 2, selectionEnd: 9, selectionDirection: 'backward' });
    pressEye(f, f);
    browserDropsTheCaret(f);
    vi.advanceTimersByTime(20);
    expect(f.setSelectionRange).toHaveBeenLastCalledWith(2, 9, 'backward');
  });

  it('scrolls a caret at the end of a long password back into view; a caret elsewhere leaves the scroll alone', () => {
    const atEnd = field({ selectionStart: 16, selectionEnd: 16 });
    pressEye(atEnd, atEnd);
    vi.advanceTimersByTime(20);
    expect(atEnd.scrollLeft).toBe(atEnd.scrollWidth);

    const inTheMiddle = field({ selectionStart: 5, selectionEnd: 5 });
    pressEye(inTheMiddle, inTheMiddle);
    vi.advanceTimersByTime(20);
    expect(inTheMiddle.scrollLeft).toBe(0);
  });

  it('does nothing when the field is not the focused element — pressing the eye must not pull focus in', () => {
    const f = field();
    pressEye(f, { not: 'the field' });
    vi.advanceTimersByTime(20);
    expect(f.setSelectionRange).not.toHaveBeenCalled();
  });

  it('only restores a caret that was in the field when the eye was pressed, not a focus that arrives later', () => {
    const f = field();
    const doc = pressEye(f, { not: 'the field' });
    doc.activeElement = f;
    vi.advanceTimersByTime(20);
    expect(f.setSelectionRange).not.toHaveBeenCalled();
  });

  it('does nothing if focus left the field before the browser settled', () => {
    const f = field();
    const doc = pressEye(f, f);
    doc.activeElement = { moved: 'elsewhere' };
    vi.advanceTimersByTime(20);
    expect(f.setSelectionRange).not.toHaveBeenCalled();
  });
});
