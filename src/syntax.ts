/**
 * The language reference handed to callers.
 *
 * An agent that has this text writes valid diagram code on the first try, which
 * is cheaper than a render, a failure and a retry.
 */

export const SYNTAX_GUIDE = `Diagram code reference

Line oriented. One instruction per line. Anything after # is a comment. Blank lines are ignored.

  title "Support ticket triage"       optional, drawn above the diagram
  direction LR                        optional, LR (default) or TB

  node <id> "<label>" [shape=...] [at=<x>,<y>] [size=<w>x<h>]
  <from> -> <to> ["label"] [style=solid|dashed]

Ids start with a letter and may hold letters, digits, _ and -. They are how connections
refer to shapes, and they never appear in the picture. The label is what is drawn.

Shapes: rect (default), rounded, ellipse, diamond, hexagon.
Aliases accepted: box, round, oval, circle, decision, hex.

Positions:
  Leave at= off and the shape is placed automatically by a layered pass that follows
  the direction. This is the right choice for most generated diagrams.
  Set at=<x>,<y> to pin a shape. x grows right, y grows down, both in pixels.
  Mixing the two is allowed: pinned shapes stay put, the rest are placed around them.

Sizes: size=<width>x<height>, default 160x64. Width 40 to 800, height 24 to 400.
Labels wrap on words to fit the shape, so widen a shape rather than shortening the text.

A complete example:

  title "Release checklist"
  direction TB

  node branch "Cut release branch" shape=rounded
  node tests "CI green?" shape=diamond size=180x96
  node fix "Fix and push"
  node ship "Deploy to production" shape=rounded

  branch -> tests
  tests -> fix "no"
  fix -> tests
  tests -> ship "yes"

Limits: 500 shapes, 1000 connections, 200 character labels, 200000 characters of code.

Notes that save a round trip:
  Every connection endpoint must be a declared node id, so declare shapes before you
  connect them. A duplicate id is an error, and only the first one is kept.
  Two connections may run between the same pair, in either direction. A shape may
  connect to itself, drawn as a small loop.
  Quotes inside a label are escaped with a backslash, and \\n starts a new line.`
