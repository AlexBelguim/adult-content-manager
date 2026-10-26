"""Constrained decoding (Alex's "jev" idea: a model that can only answer with the tokens it is given as possible responses):
while the VLM writes its JSON answer, every token that would leave the label set is masked out, so each value can only be one of
its options, the keys come in the template's order, and the answer always parses. No new dependency: a character-level matcher
over the answer's grammar decides which vocabulary tokens may come next, and the masks are cached per matcher state, so after the
first answer the masking costs next to nothing."""
import re
import torch
from transformers import LogitsProcessor

NUMBER = re.compile(r"0(\.\d{1,3})?|1(\.0{1,3})?")   # the confidence, 0..1
NUMBER_PREFIX = re.compile(r"0(\.\d{0,3})?|1(\.0{0,3})?")


class Grammar:
    """the answer as a sequence of parts: ("lit", text), ("enum", options), ("list", options) for ["a", "b"], ("number", None)
    for 0..1 with up to 3 decimals, ("text", None) for one or more characters without a quote, backslash or line break"""

    def __init__(self, parts):
        merged = []
        for kind, p in parts:   # adjacent literals as one
            if kind == "lit" and merged and merged[-1][0] == "lit":
                merged[-1] = ("lit", merged[-1][1] + p)
            else:
                merged.append((kind, p))
        self.parts = merged
        self.end = (len(merged), None)
        self.masks = {}   # matcher state -> allowed-token mask, filled as answers are written

    def start(self):
        return self.close({(0, self.first(0))})

    def first(self, i):
        kind = self.parts[i][0] if i < len(self.parts) else None
        return {"lit": 0, "enum": "", "list": ("open", ""), "number": "", "text": 0}.get(kind)

    def done(self, i, sub):
        kind, p = self.parts[i]
        if kind == "lit":
            return sub == len(p)
        if kind == "enum":
            return sub in p
        if kind == "list":
            return sub[0] == "closed"
        if kind == "number":
            return bool(NUMBER.fullmatch(sub))
        return sub == 1

    def close(self, states):
        """the states plus those reached by finishing a part without reading anything"""
        out, todo = set(), list(states)
        while todo:
            st = todo.pop()
            if st in out:
                continue
            out.add(st)
            i, sub = st
            if i < len(self.parts) and self.done(i, sub):
                todo.append((i + 1, self.first(i + 1)) if i + 1 < len(self.parts) else self.end)
        return frozenset(out)

    def step(self, st, ch):
        i, sub = st
        if i >= len(self.parts):
            return None
        kind, p = self.parts[i]
        if kind == "lit":
            return (i, sub + 1) if sub < len(p) and p[sub] == ch else None
        if kind == "enum":
            s = sub + ch
            return (i, s) if any(o.startswith(s) for o in p) else None
        if kind == "text":
            return None if ch in '"\\\n\r\t' or ord(ch) < 32 else (i, 1)
        if kind == "number":
            return (i, sub + ch) if NUMBER_PREFIX.fullmatch(sub + ch) else None
        phase, prefix = sub   # list
        if phase == "open":
            return (i, ("first", "")) if ch == "[" else None
        if phase in ("first", "next") and ch == '"':
            return (i, ("item", ""))
        if phase == "first" and ch == "]":
            return (i, ("closed", ""))
        if phase == "item":
            if ch == '"':
                return (i, ("after", "")) if prefix in p else None
            s = prefix + ch
            return (i, ("item", s)) if any(o.startswith(s) for o in p) else None
        if phase == "after":
            return (i, ("comma", "")) if ch == "," else (i, ("closed", "")) if ch == "]" else None
        if phase == "comma":
            return (i, ("next", "")) if ch == " " else None
        return None

    def read(self, states, text):
        """the states after reading text, or an empty set when it does not fit"""
        for ch in text:
            nxt = {s for s in (self.step(st, ch) for st in states) if s is not None}
            if not nxt:
                return frozenset()
            states = self.close(nxt)
        return states

    def next_chars(self, states):
        """the characters that can come next, or None when any character might (inside free text)"""
        chars = set()
        for i, sub in states:
            if i >= len(self.parts):
                continue
            kind, p = self.parts[i]
            if kind == "text":
                return None
            if kind == "lit":
                if sub < len(p):
                    chars.add(p[sub])
            elif kind == "enum":
                chars |= {o[len(sub)] for o in p if o.startswith(sub) and len(o) > len(sub)}
            elif kind == "number":
                chars |= set("01.0123456789")
            else:
                chars |= set('[]",' + " ") | {o[len(sub[1])] for o in p if o.startswith(sub[1]) and len(o) > len(sub[1])}
        return chars


class Constrained(LogitsProcessor):
    """masks every token that does not fit the grammar after what has been generated; end of answer is the only choice at the end"""

    def __init__(self, grammar, vocab, eos, prompt_len):
        self.g, self.vocab, self.eos, self.prompt_len, self.masks = grammar, vocab, eos, prompt_len, grammar.masks
        self.states, self.seen = grammar.start(), 0

    def __call__(self, input_ids, scores):
        gen = input_ids[0, self.prompt_len:].tolist()
        for t in gen[self.seen:]:
            self.states = self.g.read(self.states, self.vocab["text"][t]) if t < len(self.vocab["text"]) else frozenset()
        self.seen = len(gen)
        mask = self.masks.get(self.states)
        if mask is None:
            mask = torch.zeros(scores.shape[-1], dtype=torch.bool, device=scores.device)
            if any(st == self.g.end for st in self.states):
                mask[self.eos] = True
            chars = self.g.next_chars(self.states)
            ids = range(len(self.vocab["text"])) if chars is None else [t for c in chars for t in self.vocab["by_first"].get(c, ())]
            ok = [t for t in ids if self.vocab["plain"][t] and self.g.read(self.states, self.vocab["text"][t])]
            if ok:
                mask[ok] = True
            self.masks[self.states] = mask
        return scores.masked_fill(~mask, float("-inf"))


def vocabulary(tokenizer):
    """each token id's text, which ids are ordinary text (not special tokens), and the ids by first character"""
    special = set(tokenizer.all_special_ids) | set(getattr(tokenizer, "added_tokens_decoder", {}) or {})
    text = [tokenizer.decode([i]) for i in range(len(tokenizer))]
    plain = [i not in special and len(s) > 0 for i, s in enumerate(text)]
    by_first = {}
    for i, s in enumerate(text):
        if plain[i]:
            by_first.setdefault(s[0], []).append(i)
    return {"text": text, "plain": plain, "by_first": by_first}
