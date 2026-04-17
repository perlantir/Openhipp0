import { describe, expect, it } from 'vitest';

import { extractRange, parseSrt, parseWebVtt } from '../../../src/media/multimodal/caption-track.js';

describe('parseWebVtt', () => {
  it('parses a basic WebVTT cue block', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello world

00:00:04.000 --> 00:00:05.000
Second cue
`;
    const track = parseWebVtt(vtt);
    expect(track.captions).toHaveLength(2);
    expect(track.captions[0]!.startMs).toBe(1000);
    expect(track.captions[0]!.endMs).toBe(3500);
    expect(track.captions[1]!.text).toBe('Second cue');
  });
});

describe('parseSrt', () => {
  it('parses SRT with numeric index + comma-separated milliseconds', () => {
    const srt = `1
00:00:00,000 --> 00:00:02,500
Intro

2
00:00:02,600 --> 00:00:05,000
Details line 1
Details line 2
`;
    const track = parseSrt(srt);
    expect(track.captions).toHaveLength(2);
    expect(track.captions[1]!.text).toBe('Details line 1 Details line 2');
    expect(track.captions[1]!.startMs).toBe(2600);
  });
});

describe('extractRange', () => {
  it('concatenates captions overlapping a time window', () => {
    const track = parseWebVtt(`WEBVTT

00:00:00.000 --> 00:00:01.000
A

00:00:01.500 --> 00:00:02.500
B

00:00:03.000 --> 00:00:04.000
C
`);
    expect(extractRange(track, 1000, 2000)).toBe('B');
    expect(extractRange(track, 0, 5000)).toBe('A B C');
  });
});
