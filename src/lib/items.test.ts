import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizeItem, sameItem } from "./items";

describe("normalizeItem", () => {
  test("milk variants: one key", () => {
    for (const s of ["Milk 2%", "whole milk", "milk, 1 gal", "MILK", "1 gallon organic whole milk", "  milk  "]) assert.equal(normalizeItem(s), "milk", s);
  });

  test("eggs by count: one key", () => {
    for (const s of ["eggs 18", "18 eggs", "a dozen eggs", "Large eggs (12 ct)", "2 dozen eggs"]) assert.equal(normalizeItem(s), "eggs", s);
  });

  test("units only go when they measure something: '2 lb ground beef', 'bag of rice', but 'paper cups' stays", () => {
    assert.equal(normalizeItem("2 lb ground beef"), "ground beef");
    assert.equal(normalizeItem("bag of rice"), "rice");
    assert.equal(normalizeItem("3 bags of chips"), "chips");
    assert.equal(normalizeItem("paper cups"), "paper cups");
    assert.equal(normalizeItem("1/2 cup sugar"), "sugar");
  });

  test("what makes it a different thing stays", () => {
    assert.equal(normalizeItem("Oat Milk"), "oat milk");
    assert.equal(normalizeItem("Rice vinegar"), "rice vinegar");
    assert.equal(normalizeItem("Dawn dish soap"), "dawn dish soap");
  });

  test("a name that is all qualifier keeps its words", () => {
    assert.equal(normalizeItem("Large"), "large");
    assert.equal(normalizeItem("12"), "12");
  });
});

describe("sameItem", () => {
  test("spelling and plurals don't split a thing", () => {
    assert.equal(sameItem("Milk 2%", "whole milk"), true);
    assert.equal(sameItem("egg", "a dozen eggs"), true);
    assert.equal(sameItem("Tomatoes", "tomato"), true);
  });

  test("a narrower thing is a different thing", () => {
    assert.equal(sameItem("rice", "rice vinegar"), false);
    assert.equal(sameItem("dish soap", "soap"), false);
    assert.equal(sameItem("milk", "oat milk"), false);
    assert.equal(sameItem("chicken", "chicken broth"), false);
  });
});
