import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { addressOf, domainOf, parseForwarded } from "./forwarded";

// Recorded shapes of real forwards (names and addresses changed).

const GMAIL_PLAIN = `fyi, inspection next week

---------- Forwarded message ---------
From: Brookfield Residential Leasing <leasing@brookfieldresidential.com>
Date: Tue, Oct 27, 2026 at 3:14 PM
Subject: Annual Unit Inspection - November 3
To: <maya.rao@gmail.com>


Dear Resident,

Our maintenance team will complete the annual smoke detector and HVAC filter inspection in your unit on
Tuesday, November 3 between 9:00 AM and 12:00 PM. No need to be home.

Thank you,
Brookfield Residential Leasing Office
`;

const GMAIL_HTML = `<div dir="ltr">heads up<br><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <strong class="gmail_sendername" dir="auto">Brookfield Maintenance</strong> <span dir="auto">&lt;<a href="mailto:Maintenance@BrookfieldResidential.com">Maintenance@BrookfieldResidential.com</a>&gt;</span><br>Date: Wed, Oct 28, 2026 at 8:02 AM<br>Subject: Water shut-off Thursday 10/29 &amp; Friday<br>To: &lt;<a href="mailto:dev.patel@gmail.com">dev.patel@gmail.com</a>&gt;<br></div><br><br><div dir="ltr"><p>Residents,</p><p>Water to Building C will be shut off on Thursday, October 29 from 10am to 2pm for a riser repair.</p></div></div></div>`;

const OUTLOOK = `Forwarding this, can someone be home?

________________________________
From: Brookfield Work Orders <workorders@brookfieldresidential.com>
Sent: Monday, October 26, 2026 9:02 AM
To: Sam Kim <sam.kim@outlook.com>
Subject: Work Order #48213 - Kitchen sink

Hi Sam,

A plumber is scheduled for Tuesday between 10 and 12.
`;

const OUTLOOK_HTML = `<div>see below</div><hr style="display:inline-block;width:98%"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>From:</b> leasing@brookfieldresidential.com &lt;leasing@brookfieldresidential.com&gt;<br><b>Sent:</b> Friday, October 23, 2026 4:45 PM<br><b>To:</b> Sam Kim &lt;sam.kim@outlook.com&gt;<br><b>Subject:</b> 2027 Renewal Offer</font><div>&nbsp;</div></div><div>Your renewal offer is attached.</div>`;

const APPLE = `Sent from my iPhone

Begin forwarded message:

> From: "Brookfield Leasing" <leasing@brookfieldresidential.com>
> Date: October 27, 2026 at 3:14:00 PM CDT
> Subject: Package room hours
> To: maya.rao@icloud.com

> The package room will close at 6pm this week.
`;

// A direct email from the landlord that quotes an earlier reply: not a forward.
const DIRECT_REPLY = `Hi Maya,

We can move the inspection to Thursday at 10am.

Best,
Priya, Leasing

On Tue, Oct 27, 2026 at 5:40 PM Roomie <apt-4b-k2x9@agentmail.to> wrote:
> Could the inspection on November 3 move to Thursday?
> From the residents of Apt 4B
`;

describe("parseForwarded", () => {
  test("Gmail plain-text forward: the original sender, date and subject", () => {
    assert.deepEqual(parseForwarded(GMAIL_PLAIN, null), {
      from: "leasing@brookfieldresidential.com",
      name: "Brookfield Residential Leasing",
      date: "Tue, Oct 27, 2026 at 3:14 PM",
      subject: "Annual Unit Inspection - November 3",
    });
  });

  test("Gmail HTML-only forward (no text part): tags and entities stripped, address lowercased", () => {
    assert.deepEqual(parseForwarded("", GMAIL_HTML), {
      from: "maintenance@brookfieldresidential.com",
      name: "Brookfield Maintenance",
      date: "Wed, Oct 28, 2026 at 8:02 AM",
      subject: "Water shut-off Thursday 10/29 & Friday",
    });
  });

  test("Outlook forward: Sent: is the date", () => {
    assert.deepEqual(parseForwarded(OUTLOOK, null), {
      from: "workorders@brookfieldresidential.com",
      name: "Brookfield Work Orders",
      date: "Monday, October 26, 2026 9:02 AM",
      subject: "Work Order #48213 - Kitchen sink",
    });
  });

  test("Outlook HTML forward with bold labels and an address as the name", () => {
    const got = parseForwarded("", OUTLOOK_HTML);
    assert.equal(got?.from, "leasing@brookfieldresidential.com");
    assert.equal(got?.name, undefined);
    assert.equal(got?.subject, "2027 Renewal Offer");
    assert.equal(got?.date, "Friday, October 23, 2026 4:45 PM");
  });

  test("Apple Mail forward with quoted header lines", () => {
    const got = parseForwarded(APPLE, null);
    assert.equal(got?.from, "leasing@brookfieldresidential.com");
    assert.equal(got?.name, "Brookfield Leasing");
    assert.equal(got?.subject, "Package room hours");
  });

  test("the text part wins when both are there", () => {
    assert.equal(parseForwarded(GMAIL_PLAIN, GMAIL_HTML)?.from, "leasing@brookfieldresidential.com");
  });

  test("not a forward: a direct reply that quotes earlier mail, or plain mail", () => {
    assert.equal(parseForwarded(DIRECT_REPLY, null), null);
    assert.equal(parseForwarded("The pool reopens Saturday.", "<p>The pool reopens Saturday.</p>"), null);
    assert.equal(parseForwarded("", null), null);
  });

  test("a forward marker with no From: line is not a forward we can use", () => {
    assert.equal(parseForwarded("---------- Forwarded message ---------\nSubject: hi\n\nbody", null), null);
  });
});

describe("addressOf / domainOf", () => {
  test("bare address from a header, lowercased", () => {
    assert.equal(addressOf("Brookfield Leasing <Leasing@BrookfieldResidential.com>"), "leasing@brookfieldresidential.com");
    assert.equal(addressOf("leasing@brookfieldresidential.com"), "leasing@brookfieldresidential.com");
    assert.equal(addressOf("no address here"), null);
  });
  test("domain of an address", () => {
    assert.equal(domainOf("leasing@brookfieldresidential.com"), "brookfieldresidential.com");
    assert.equal(domainOf("Brookfield <x@Mail.Brookfield.com>"), "mail.brookfield.com");
  });
});
