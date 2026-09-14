// Is this a DEBUG build? Shipped value: no.
//
// `python serve.py 8734 --debug` serves this ONE file with `true` instead,
// which is the only thing that makes main.js dynamically import js/debug.js.
// Nothing else in the game reaches for the debug module, so:
//   * a normal server, and the double-click single-file build, never load it;
//   * build.js walks STATIC imports only, so debug.js cannot reach the
//     artifact even by accident (test_build.js asserts that).
// The file on disk is the shipped answer -- do not flip it to commit a
// debug build.
export const DEBUG_BUILD = false;
