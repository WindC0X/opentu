import { describe, expect, it } from 'vitest';
import {
  buildPPTSlideTransitionXml,
  injectPPTSlideTransitions,
  normalizePPTSlideTransition,
} from '../ppt-transitions';
import type { PPTSlideTransition } from '../ppt.types';

const slideXml = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
  '<p:cSld><p:spTree /></p:cSld>',
  '</p:sld>',
].join('');

const transitionCases = [
  ['fade', '<p:fade'],
  ['push', '<p:push'],
  ['wipe', '<p:wipe'],
  ['split', '<p:split'],
  ['cover', '<p:cover'],
  ['uncover', '<p:pull'],
] as const;

function malformedTransition(
  value: Record<string, unknown>
): Partial<PPTSlideTransition> {
  return value as unknown as Partial<PPTSlideTransition>;
}

describe('ppt-transitions', () => {
  describe('normalizePPTSlideTransition', () => {
    it('treats missing or invalid transition metadata as none', () => {
      expect(normalizePPTSlideTransition(undefined).type).toBe('none');
      expect(normalizePPTSlideTransition(null).type).toBe('none');
      expect(
        normalizePPTSlideTransition(malformedTransition({ type: 'invalid' }))
          .type
      ).toBe('none');
      expect(normalizePPTSlideTransition({ type: 'fade' }).type).toBe('fade');
    });
  });

  describe('buildPPTSlideTransitionXml', () => {
    it.each(transitionCases)(
      'builds reasonable OOXML for %s transitions',
      (type, expectedTag) => {
        const xml = buildPPTSlideTransitionXml({ type, durationMs: 700 });

        expect(xml).toContain('<p:transition');
        expect(xml).toContain(expectedTag);
        expect(xml).toContain('</p:transition>');
        expect(xml).not.toContain('invalid');
      }
    );

    it('returns empty XML for invalid or none transitions', () => {
      expect(buildPPTSlideTransitionXml({ type: 'none' })).toBe('');
      expect(
        buildPPTSlideTransitionXml(malformedTransition({ type: 'invalid' }))
      ).toBe('');
    });
  });

  describe('injectPPTSlideTransitions', () => {
    it.each(transitionCases)(
      'injects %s transition XML into a slide',
      (type, expectedTag) => {
        const xml = injectPPTSlideTransitions(slideXml, {
          type,
          durationMs: 700,
        });

        expect(xml).toContain('<p:transition');
        expect(xml).toContain(expectedTag);
        expect(xml).toContain('<p:cSld><p:spTree /></p:cSld>');
        expect(xml).toContain('</p:sld>');
      }
    );

    it('leaves slide XML unchanged when there is no transition', () => {
      expect(injectPPTSlideTransitions(slideXml, undefined)).toBe(slideXml);
      expect(injectPPTSlideTransitions(slideXml, { type: 'none' })).toBe(
        slideXml
      );
      expect(
        injectPPTSlideTransitions(
          slideXml,
          malformedTransition({ type: 'invalid' })
        )
      ).toBe(slideXml);
    });

    it('replaces existing transition XML instead of duplicating it', () => {
      const withExistingTransition = slideXml.replace(
        '</p:cSld>',
        '</p:cSld><p:transition spd="fast"><p:fade/></p:transition>'
      );
      const xml = injectPPTSlideTransitions(withExistingTransition, {
        type: 'push',
        durationMs: 700,
      });

      expect(xml.match(/<p:transition/g)).toHaveLength(1);
      expect(xml).toContain('<p:push');
      expect(xml).not.toContain('<p:fade');
    });

    it('removes existing self-closing transition XML for none', () => {
      const withExistingTransition = slideXml.replace(
        '</p:cSld>',
        '</p:cSld><p:transition spd="fast"/>'
      );

      expect(
        injectPPTSlideTransitions(withExistingTransition, { type: 'none' })
      ).toBe(slideXml);
    });
  });
});
