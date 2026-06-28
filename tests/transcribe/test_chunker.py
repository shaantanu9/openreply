"""Chunker honours the max_chars cap and preserves boundary timestamps."""
from __future__ import annotations


def _seg(start, end, text):
    class S:
        pass
    s = S()
    s.start = start
    s.end = end
    s.text = text
    return s


def test_empty_input_returns_empty():
    from openreply.transcribe.chunker import chunk_segments
    assert chunk_segments([]) == []


def test_single_short_segment_becomes_one_chunk():
    from openreply.transcribe.chunker import chunk_segments
    out = chunk_segments([_seg(0.0, 3.5, "Hello world.")])
    assert len(out) == 1
    assert out[0]["chunk_idx"] == 0
    assert out[0]["text"] == "Hello world."
    assert out[0]["timestamp_start"] == 0.0
    assert out[0]["timestamp_end"] == 3.5


def test_packs_until_max_chars_then_splits():
    from openreply.transcribe.chunker import chunk_segments
    segs = [
        _seg(0.0, 1.0, "a" * 100),
        _seg(1.0, 2.0, "b" * 100),
        _seg(2.0, 3.0, "c" * 100),  # forces split: 200+1+100 = 301 <= 500, still fits
        _seg(3.0, 4.0, "d" * 300),  # 300+1+300 = 601 > 500 → break
    ]
    out = chunk_segments(segs, max_chars=500)
    assert len(out) == 2
    assert out[0]["timestamp_start"] == 0.0
    assert out[0]["timestamp_end"] == 3.0
    assert out[1]["timestamp_start"] == 3.0
    assert out[1]["timestamp_end"] == 4.0
    assert out[1]["chunk_idx"] == 1


def test_oversized_segment_emitted_intact():
    """A single segment longer than max_chars must not be split."""
    from openreply.transcribe.chunker import chunk_segments
    big = "x" * 800
    out = chunk_segments([_seg(0.0, 10.0, big)], max_chars=500)
    assert len(out) == 1
    assert out[0]["text"] == big


def test_srt_output_has_block_per_segment():
    from openreply.transcribe.chunker import segments_to_srt
    srt = segments_to_srt([
        _seg(0.0,  2.0, "one"),
        _seg(2.5,  4.0, "two"),
    ])
    # SRT blocks are separated by a blank line
    assert srt.count("\n\n") >= 1
    assert "00:00:00,000 --> 00:00:02,000" in srt
    assert "one" in srt and "two" in srt
