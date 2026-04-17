import { describe, expect, it } from 'vitest';

import { inferFieldKind } from '../../src/forms/field-inference.js';

describe('inferFieldKind', () => {
  it('classifies standard HTML input types', () => {
    expect(inferFieldKind({ ref: 'r', node: { role: 'textbox' }, attributes: { type: 'email' } }).kind).toBe('email');
    expect(inferFieldKind({ ref: 'r', node: { role: 'textbox' }, attributes: { type: 'password' } }).kind).toBe('password');
    expect(inferFieldKind({ ref: 'r', node: { role: 'textbox' }, attributes: { type: 'date' } }).kind).toBe('date');
    expect(inferFieldKind({ ref: 'r', node: { role: 'textbox' }, attributes: { type: 'tel' } }).kind).toBe('phone');
    expect(inferFieldKind({ ref: 'r', node: { role: 'textbox' }, attributes: { type: 'color' } }).kind).toBe('color');
    expect(inferFieldKind({ ref: 'r', node: { role: 'textbox' }, attributes: { type: 'range' } }).kind).toBe('slider');
    expect(inferFieldKind({ ref: 'r', node: { role: 'textbox' }, attributes: { type: 'file' } }).kind).toBe('file');
  });

  it('classifies roles when input type is absent', () => {
    expect(inferFieldKind({ ref: 'r', node: { role: 'slider', value: 50 } }).kind).toBe('slider');
    expect(inferFieldKind({ ref: 'r', node: { role: 'checkbox', checked: true } }).kind).toBe('checkbox');
    expect(inferFieldKind({ ref: 'r', node: { role: 'combobox' } }).kind).toBe('select');
  });

  it('detects datepicker from textbox + aria-haspopup=dialog + date-shaped value', () => {
    const res = inferFieldKind({
      ref: 'r',
      node: { role: 'textbox', value: '2026-04-17' },
      attributes: { 'aria-haspopup': 'dialog' },
    });
    expect(res.kind).toBe('datepicker');
  });

  it('identifies Quill / CKEditor / TinyMCE / Draft.js via DOM class signatures', () => {
    expect(
      inferFieldKind({
        ref: 'r',
        node: { role: 'textbox' },
        outerHtml: '<div class="ql-editor" contenteditable="true">...</div>',
      }).kind,
    ).toBe('rich-text-quill');
    expect(
      inferFieldKind({
        ref: 'r',
        node: { role: 'textbox' },
        outerHtml: '<div class="cke_contents">...</div>',
      }).kind,
    ).toBe('rich-text-ckeditor');
    expect(
      inferFieldKind({
        ref: 'r',
        node: { role: 'textbox' },
        outerHtml: '<div class="tox-edit-area">...</div>',
      }).kind,
    ).toBe('rich-text-tinymce');
    expect(
      inferFieldKind({
        ref: 'r',
        node: { role: 'textbox' },
        outerHtml: '<div class="DraftEditor-editorContainer">...</div>',
      }).kind,
    ).toBe('rich-text-draftjs');
  });

  it('detects map containers', () => {
    expect(
      inferFieldKind({
        ref: 'r',
        node: { role: 'application' },
        outerHtml: '<div class="leaflet-container">...</div>',
      }).kind,
    ).toBe('map-pin');
  });

  it('falls back to text when signals are absent', () => {
    const res = inferFieldKind({ ref: 'r', node: { role: 'textbox' } });
    expect(res.kind).toBe('text');
    expect(res.evidence).toContain('fallback');
  });
});
