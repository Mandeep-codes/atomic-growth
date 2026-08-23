import express from "express";
import {
  Inbound,
  verifyWebhookFromHeaders,
  type InboundWebhookPayload,
} from "inboundemail";
import { env } from "./lib/env";
import { db } from "./lib/db";
import { verified_login_credentials, verified_users } from "./lib/schema";
import { and, eq, isNull } from "drizzle-orm";

const inboundClient = new Inbound({
  apiKey: env.INBOUND_API_KEY,
});

export const setupInboundWebhook = async (app: express.Application) => {
  app.post("/webhooks/inbound", async (req, res) => {
    try {
      const isValid = await verifyWebhookFromHeaders(
        req.headers,
        inboundClient
      );

      if (!isValid) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const payload = req.body as InboundWebhookPayload;

      if (!payload?.email) {
        return res.status(400).json({ error: "Invalid payload" });
      }

      const { email } = payload;

      const [loginCredentials] = await db
        .select()
        .from(verified_login_credentials)
        .where(and(eq(verified_login_credentials.email, email.recipient)));

      if (!loginCredentials) {
        return res
          .status(400)
          .json({ error: "login credential email not found" });
      }

      if (!loginCredentials.forwarding_email) {
        return res
          .status(400)
          .json({ error: "login credential forwarding email not found" });
      }

      const domain =
        loginCredentials?.email?.split("@")[1] ?? "atmgrwthclip.com";

      await inboundClient.emails.send({
        from: `no-reply@${domain}`,
        to: [loginCredentials.forwarding_email],
        subject: email.subject ?? "No subject",
        text: email.parsedData.textBody ?? undefined,
        html: email.parsedData.htmlBody ?? undefined,
      });

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Failed to handle inbound webhook", error);
      return res.status(500).json({ error: "Failed to handle webhook" });
    }
  });
};

// const TEST_PAYLOAD = {
//   event: "email.received",
//   timestamp: "2025-11-24T17:13:30.070Z",
//   email: {
//     id: "inbnd_b9059e908e78a097",
//     messageId:
//       "<CAM5PGGKYc8oDqGnaOzJ=q0E4Kswn+owg7272i+UaTW5FrKcsug@mail.gmail.com>",
//     from: {
//       text: '"Sebastian Ruiz" <sebruizufl@gmail.com>',
//       addresses: [
//         {
//           name: "Sebastian Ruiz",
//           address: "sebruizufl@gmail.com",
//         },
//       ],
//     },
//     to: {
//       text: "whoever@atmgrwthclip.com",
//       addresses: [
//         {
//           name: null,
//           address: "whoever@atmgrwthclip.com",
//         },
//       ],
//     },
//     recipient: "whoever@atmgrwthclip.com",
//     subject: "Fwd: whomever it concerns",
//     receivedAt: "2025-11-24T17:13:15.000Z",
//     threadId: "u89SkkXP03tM1e-ZlmY3o",
//     threadPosition: 3,
//     parsedData: {
//       messageId:
//         "<CAM5PGGKYc8oDqGnaOzJ=q0E4Kswn+owg7272i+UaTW5FrKcsug@mail.gmail.com>",
//       date: "2025-11-24T17:13:15.000Z",
//       subject: "Fwd: whomever it concerns",
//       from: {
//         text: '"Sebastian Ruiz" <sebruizufl@gmail.com>',
//         addresses: [
//           {
//             name: "Sebastian Ruiz",
//             address: "sebruizufl@gmail.com",
//           },
//         ],
//       },
//       to: {
//         text: "whoever@atmgrwthclip.com",
//         addresses: [
//           {
//             name: null,
//             address: "whoever@atmgrwthclip.com",
//           },
//         ],
//       },
//       cc: null,
//       bcc: null,
//       replyTo: null,
//       inReplyTo:
//         "<CAM5PGGL3h0tBkwscfnJ-H_eDRp+jYLhGmSswdyE8m_WWRakvUw@mail.gmail.com>",
//       references: [
//         "<CAM5PGGL3h0tBkwscfnJ-H_eDRp+jYLhGmSswdyE8m_WWRakvUw@mail.gmail.com>",
//       ],
//       textBody:
//         "---------- Forwarded message ---------\nFrom: Sebastian Ruiz <sebruizufl@gmail.com>\nDate: Mon, Nov 24, 2025 at 12:12 PM\nSubject: whomever it concerns\nTo: <whomever@atmgrwthclip.com>\n\n\nya know\n",
//       htmlBody:
//         '<div dir="ltr"><br><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <b class="gmail_sendername" dir="auto">Sebastian Ruiz</b> <span dir="auto">&lt;<a href="mailto:sebruizufl@gmail.com">sebruizufl@gmail.com</a>&gt;</span><br>Date: Mon, Nov 24, 2025 at 12:12 PM<br>Subject: whomever it concerns<br>To:  &lt;<a href="mailto:whomever@atmgrwthclip.com">whomever@atmgrwthclip.com</a>&gt;<br></div><br><br><div dir="ltr">ya know</div>\n</div></div>\n',
//       raw: 'Return-Path: <sebruizufl@gmail.com>\r\nReceived: from mail-lj1-f178.google.com (mail-lj1-f178.google.com [209.85.208.178])\r\n by inbound-smtp.us-east-2.amazonaws.com with SMTP id eehuir1ejdq47mmk0bfhl19jj9ttrp7kp3pmuk81\r\n for whoever@atmgrwthclip.com;\r\n Mon, 24 Nov 2025 17:13:28 +0000 (UTC)\r\nReceived-SPF: pass (spfCheck: domain of _spf.google.com designates 209.85.208.178 as permitted sender) client-ip=209.85.208.178; envelope-from=sebruizufl@gmail.com; helo=mail-lj1-f178.google.com;\r\nAuthentication-Results: amazonses.com;\r\n spf=pass (spfCheck: domain of _spf.google.com designates 209.85.208.178 as permitted sender) client-ip=209.85.208.178; envelope-from=sebruizufl@gmail.com; helo=mail-lj1-f178.google.com;\r\n dkim=pass header.i=@gmail.com;\r\n dmarc=pass header.from=gmail.com;\r\nX-SES-RECEIPT: AEFBQUFBQUFBQUFGMjhiQlAxaVFhaFZhbzR4eFJkMEJxNVlLV09EenFCaE1jODBRK08rSXo3SHo0eWhIV0FGaDRKR2ttY2ZUQWxJdXJreDJXNk5wV05jTjU0MjV4aFV3cEFySHdzWHd5a0ZlVkRJQ0RCSFZMM0lkRGxyY0tVNzhjWVRvSVk5SW9NcUtFL2E4ZVNNalZlaGxLTGN2Y1FSakhiaFIyT2JTZU5tQnJaUzVtZnZOOWVQT2RucXFQaGkzbDBMLzcyNGVsVlAzdGZtVURpRVRnUjdwUEhtM2pPbXY3TC9oWkloZGNCbzFhSGNiZzUvc2hZVlVoMUxvU0lXWGpudkxCSHlLQVpUUnNZN2YyaUU3RDNiKzh6N04zZmhkMmpnTVpQTFV3b3Q4Z3pVTUNBNHJMSGc9PQ==\r\nX-SES-DKIM-SIGNATURE: a=rsa-sha256; q=dns/txt; b=oqA4tCDC/hPLBR3ThsvCGQ4nTxfEZCtPclOhRY3SBcBaHAYxXYk/o6G4OiGlNFK1GQ+PUJw3ra3v/bE64M1nv/7W733bv53KGDQ9py67AcSUQ53Dtc6PrksNl23RLrP4mTIz56sa8XFW8s3Bk6b6/mYcNwS1OM0fjcQuF6y3mgQ=; c=relaxed/simple; s=ndjes4mrtuzus6qxu3frw3ubo3gpjndv; d=amazonses.com; t=1764004408; v=1; bh=a90BIE9J1SVlhXy3W696IzF2J5VR3p8W5EKmZtBWtjM=; h=From:To:Cc:Bcc:Subject:Date:Message-ID:MIME-Version:Content-Type:X-SES-RECEIPT;\r\nReceived: by mail-lj1-f178.google.com with SMTP id 38308e7fff4ca-378e8d10494so56814001fa.2\r\n        for <whoever@atmgrwthclip.com>; Mon, 24 Nov 2025 09:13:28 -0800 (PST)\r\nDKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;\r\n        d=gmail.com; s=20230601; t=1764004406; x=1764609206; darn=atmgrwthclip.com;\r\n        h=to:subject:message-id:date:from:in-reply-to:references:mime-version\r\n         :from:to:cc:subject:date:message-id:reply-to;\r\n        bh=sMgKVfQJFfdgjKiM7KrpJYE4lexFgd06X7gmn87H/iY=;\r\n        b=mgbOJkbC6p83fzxu9dFZbUxI4ZaIVQHPlVHTZM6oe9v81Pe4Dtj4lF26Oyb8B+trC9\r\n         oi3sRPgtPHSFOOaj8z5xiGmPE/VVdQvFv0enbY+oPf9/ekc00t/9CwEDEOYBPY+HtRtF\r\n         e3MAXbXhpqWmP9kvcYg1F+PnMhFpuC5/lm9hdD5R3PlwHz90TCBgtE6extfWTfNQlE2n\r\n         OnCWRyVOjJ4A5VLvhH7NXRYWOnFt7v3T5cUlUOBwBfcbSyTA/GvQM44NYNesILQRCRsJ\r\n         eHGWpNeTAyxGB38143po99TAKhqPwTbE6FRqAaZOchbulrFRNQlKDlKCSBtuZO8lWPCD\r\n         x7YQ==\r\nX-Google-DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed;\r\n        d=1e100.net; s=20230601; t=1764004406; x=1764609206;\r\n        h=to:subject:message-id:date:from:in-reply-to:references:mime-version\r\n         :x-gm-gg:x-gm-message-state:from:to:cc:subject:date:message-id\r\n         :reply-to;\r\n        bh=sMgKVfQJFfdgjKiM7KrpJYE4lexFgd06X7gmn87H/iY=;\r\n        b=pUkSeoyS46wHpGWiYOoF0weHiKkQ27UOFSpqPxJMS5IJ/rgye19KaXlY4iOgndsNBK\r\n         +WHgFP5ffo+XsjZerVOnpl823udhjFdxyWS+Hja7qrV6yR7GytGYPj3orAZR7O5GoAf3\r\n         OTnW/CCGWZwsMmIJy7AKAXc0yXOfDSnR7YjVI05p406/UiY4nf+aBZLgMpZcwT/+hh6V\r\n         /lajbFU90xNToTvnFFstnkdqceB0HhD9XYQdASdGbMLgDbqanXgWy90woPh+a7eIqkFf\r\n         Q0g61/8abqlmszseiR9yFzaIVYk0DBO98cISR/UQSYlw0pC3ALXOWtZ83teVs6S52iVU\r\n         dBXQ==\r\nX-Gm-Message-State: AOJu0YzYMYvNZcBbP/tgVAgjRVZ60ri2v/AhTcLBM+lkTkSC+ZGDQqKJ\r\n\tIhvsRXj3ysUMbipbbfUNgKP/hnI3nJo2tev3xTx/hOvVT9GWzlreykT85wlJqjVSINxTalpANNo\r\n\tNNmvFcLUjvgxVXShsrm45psyQnGhEg3AFf5Po\r\nX-Gm-Gg: ASbGncsSvsD3Vc+r2W+rUnRYaIa3U3UkZrahOK1AsB6/IGfXcRMBp4rzxNG2T+FDlba\r\n\tHrBQJBAh9JrbitdNlrGDaadMGa97AKdStnmMnogHPv1ZLU+oEe6K0hc8SRuSTuQnyIlOLGeQPc/\r\n\tpuAFg7fooKquJY0D53cMUsKhlkVMRu0E7lcpFPW6HGAlqt5Xwswa+qXorEFzR75BNMUeCiWi2X5\r\n\tXGnEF8ZE3lebQp4faCMUfCAkFT3BKeI2Pb03aXBBnVU0MDCjUkY2Iu+Q0VMR4nTvJyrqD0r9ptX\r\n\thJcqb7bRHXp/ZKPxpeadF2xKUJ85srHvX3o/lAm+//qGHDTc00SyDSUxzq5S\r\nX-Google-Smtp-Source: AGHT+IFDG4+nUQuxLRs5kG51xmt613Qvt9MfMnMGbPjTO46hZvUqJXrnMn85pfwkyR044PZqC1BHF3BWR4qEkIec9OI=\r\nX-Received: by 2002:a2e:8a88:0:b0:37b:afdc:bb0d with SMTP id\r\n 38308e7fff4ca-37cd9153314mr34360291fa.6.1764004406238; Mon, 24 Nov 2025\r\n 09:13:26 -0800 (PST)\r\nMIME-Version: 1.0\r\nReferences: <CAM5PGGL3h0tBkwscfnJ-H_eDRp+jYLhGmSswdyE8m_WWRakvUw@mail.gmail.com>\r\nIn-Reply-To: <CAM5PGGL3h0tBkwscfnJ-H_eDRp+jYLhGmSswdyE8m_WWRakvUw@mail.gmail.com>\r\nFrom: Sebastian Ruiz <sebruizufl@gmail.com>\r\nDate: Mon, 24 Nov 2025 12:13:15 -0500\r\nX-Gm-Features: AWmQ_bktcT09YPT7KiwINkQppTp688LfK56ZTVfe6mNabX8BnR4C5D5Sbu1bNqM\r\nMessage-ID: <CAM5PGGKYc8oDqGnaOzJ=q0E4Kswn+owg7272i+UaTW5FrKcsug@mail.gmail.com>\r\nSubject: Fwd: whomever it concerns\r\nTo: whoever@atmgrwthclip.com\r\nContent-Type: multipart/alternative; boundary="00000000000004265c06445a4826"\r\n\r\n--00000000000004265c06445a4826\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n---------- Forwarded message ---------\r\nFrom: Sebastian Ruiz <sebruizufl@gmail.com>\r\nDate: Mon, Nov 24, 2025 at 12:12=E2=80=AFPM\r\nSubject: whomever it concerns\r\nTo: <whomever@atmgrwthclip.com>\r\n\r\n\r\nya know\r\n\r\n--00000000000004265c06445a4826\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<div dir=3D"ltr"><br><br><div class=3D"gmail_quote gmail_quote_container"><=\r\ndiv dir=3D"ltr" class=3D"gmail_attr">---------- Forwarded message ---------=\r\n<br>From: <b class=3D"gmail_sendername" dir=3D"auto">Sebastian Ruiz</b> <sp=\r\nan dir=3D"auto">&lt;<a href=3D"mailto:sebruizufl@gmail.com">sebruizufl@gmai=\r\nl.com</a>&gt;</span><br>Date: Mon, Nov 24, 2025 at 12:12=E2=80=AFPM<br>Subj=\r\nect: whomever it concerns<br>To:  &lt;<a href=3D"mailto:whomever@atmgrwthcl=\r\nip.com">whomever@atmgrwthclip.com</a>&gt;<br></div><br><br><div dir=3D"ltr"=\r\n>ya know</div>\r\n</div></div>\r\n\r\n--00000000000004265c06445a4826--\r\n',
//       attachments: [],
//       headers: {
//         "return-path": {
//           value: [
//             {
//               address: "sebruizufl@gmail.com",
//               name: "",
//             },
//           ],
//           html: '<span class="mp_address_group"><a href="mailto:sebruizufl@gmail.com" class="mp_address_email">sebruizufl@gmail.com</a></span>',
//           text: "sebruizufl@gmail.com",
//         },
//         received: [
//           "from mail-lj1-f178.google.com (mail-lj1-f178.google.com [209.85.208.178]) by inbound-smtp.us-east-2.amazonaws.com with SMTP id eehuir1ejdq47mmk0bfhl19jj9ttrp7kp3pmuk81 for whoever@atmgrwthclip.com; Mon, 24 Nov 2025 17:13:28 +0000 (UTC)",
//           "by mail-lj1-f178.google.com with SMTP id 38308e7fff4ca-378e8d10494so56814001fa.2 for <whoever@atmgrwthclip.com>; Mon, 24 Nov 2025 09:13:28 -0800 (PST)",
//         ],
//         "received-spf":
//           "pass (spfCheck: domain of _spf.google.com designates 209.85.208.178 as permitted sender) client-ip=209.85.208.178; envelope-from=sebruizufl@gmail.com; helo=mail-lj1-f178.google.com;",
//         "authentication-results":
//           "amazonses.com; spf=pass (spfCheck: domain of _spf.google.com designates 209.85.208.178 as permitted sender) client-ip=209.85.208.178; envelope-from=sebruizufl@gmail.com; helo=mail-lj1-f178.google.com; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com;",
//         "x-ses-receipt":
//           "AEFBQUFBQUFBQUFGMjhiQlAxaVFhaFZhbzR4eFJkMEJxNVlLV09EenFCaE1jODBRK08rSXo3SHo0eWhIV0FGaDRKR2ttY2ZUQWxJdXJreDJXNk5wV05jTjU0MjV4aFV3cEFySHdzWHd5a0ZlVkRJQ0RCSFZMM0lkRGxyY0tVNzhjWVRvSVk5SW9NcUtFL2E4ZVNNalZlaGxLTGN2Y1FSakhiaFIyT2JTZU5tQnJaUzVtZnZOOWVQT2RucXFQaGkzbDBMLzcyNGVsVlAzdGZtVURpRVRnUjdwUEhtM2pPbXY3TC9oWkloZGNCbzFhSGNiZzUvc2hZVlVoMUxvU0lXWGpudkxCSHlLQVpUUnNZN2YyaUU3RDNiKzh6N04zZmhkMmpnTVpQTFV3b3Q4Z3pVTUNBNHJMSGc9PQ==",
//         "x-ses-dkim-signature":
//           "a=rsa-sha256; q=dns/txt; b=oqA4tCDC/hPLBR3ThsvCGQ4nTxfEZCtPclOhRY3SBcBaHAYxXYk/o6G4OiGlNFK1GQ+PUJw3ra3v/bE64M1nv/7W733bv53KGDQ9py67AcSUQ53Dtc6PrksNl23RLrP4mTIz56sa8XFW8s3Bk6b6/mYcNwS1OM0fjcQuF6y3mgQ=; c=relaxed/simple; s=ndjes4mrtuzus6qxu3frw3ubo3gpjndv; d=amazonses.com; t=1764004408; v=1; bh=a90BIE9J1SVlhXy3W696IzF2J5VR3p8W5EKmZtBWtjM=; h=From:To:Cc:Bcc:Subject:Date:Message-ID:MIME-Version:Content-Type:X-SES-RECEIPT;",
//         "dkim-signature": {
//           value: "v=1",
//           params: {
//             a: "rsa-sha256",
//             c: "relaxed/relaxed",
//             d: "gmail.com",
//             s: "20230601",
//             t: "1764004406",
//             x: "1764609206",
//             darn: "atmgrwthclip.com",
//             h: "to:subject:message-id:date:from:in-reply-to:references:mime-version :from:to:cc:subject:date:message-id:reply-to",
//             bh: "sMgKVfQJFfdgjKiM7KrpJYE4lexFgd06X7gmn87H/iY=",
//             b: "mgbOJkbC6p83fzxu9dFZbUxI4ZaIVQHPlVHTZM6oe9v81Pe4Dtj4lF26Oyb8B+trC9 oi3sRPgtPHSFOOaj8z5xiGmPE/VVdQvFv0enbY+oPf9/ekc00t/9CwEDEOYBPY+HtRtF e3MAXbXhpqWmP9kvcYg1F+PnMhFpuC5/lm9hdD5R3PlwHz90TCBgtE6extfWTfNQlE2n OnCWRyVOjJ4A5VLvhH7NXRYWOnFt7v3T5cUlUOBwBfcbSyTA/GvQM44NYNesILQRCRsJ eHGWpNeTAyxGB38143po99TAKhqPwTbE6FRqAaZOchbulrFRNQlKDlKCSBtuZO8lWPCD x7YQ==",
//           },
//         },
//         "x-google-dkim-signature":
//           "v=1; a=rsa-sha256; c=relaxed/relaxed; d=1e100.net; s=20230601; t=1764004406; x=1764609206; h=to:subject:message-id:date:from:in-reply-to:references:mime-version :x-gm-gg:x-gm-message-state:from:to:cc:subject:date:message-id :reply-to; bh=sMgKVfQJFfdgjKiM7KrpJYE4lexFgd06X7gmn87H/iY=; b=pUkSeoyS46wHpGWiYOoF0weHiKkQ27UOFSpqPxJMS5IJ/rgye19KaXlY4iOgndsNBK +WHgFP5ffo+XsjZerVOnpl823udhjFdxyWS+Hja7qrV6yR7GytGYPj3orAZR7O5GoAf3 OTnW/CCGWZwsMmIJy7AKAXc0yXOfDSnR7YjVI05p406/UiY4nf+aBZLgMpZcwT/+hh6V /lajbFU90xNToTvnFFstnkdqceB0HhD9XYQdASdGbMLgDbqanXgWy90woPh+a7eIqkFf Q0g61/8abqlmszseiR9yFzaIVYk0DBO98cISR/UQSYlw0pC3ALXOWtZ83teVs6S52iVU dBXQ==",
//         "x-gm-message-state":
//           "AOJu0YzYMYvNZcBbP/tgVAgjRVZ60ri2v/AhTcLBM+lkTkSC+ZGDQqKJ IhvsRXj3ysUMbipbbfUNgKP/hnI3nJo2tev3xTx/hOvVT9GWzlreykT85wlJqjVSINxTalpANNo NNmvFcLUjvgxVXShsrm45psyQnGhEg3AFf5Po",
//         "x-gm-gg":
//           "ASbGncsSvsD3Vc+r2W+rUnRYaIa3U3UkZrahOK1AsB6/IGfXcRMBp4rzxNG2T+FDlba HrBQJBAh9JrbitdNlrGDaadMGa97AKdStnmMnogHPv1ZLU+oEe6K0hc8SRuSTuQnyIlOLGeQPc/ puAFg7fooKquJY0D53cMUsKhlkVMRu0E7lcpFPW6HGAlqt5Xwswa+qXorEFzR75BNMUeCiWi2X5 XGnEF8ZE3lebQp4faCMUfCAkFT3BKeI2Pb03aXBBnVU0MDCjUkY2Iu+Q0VMR4nTvJyrqD0r9ptX hJcqb7bRHXp/ZKPxpeadF2xKUJ85srHvX3o/lAm+//qGHDTc00SyDSUxzq5S",
//         "x-google-smtp-source":
//           "AGHT+IFDG4+nUQuxLRs5kG51xmt613Qvt9MfMnMGbPjTO46hZvUqJXrnMn85pfwkyR044PZqC1BHF3BWR4qEkIec9OI=",
//         "x-received":
//           "by 2002:a2e:8a88:0:b0:37b:afdc:bb0d with SMTP id 38308e7fff4ca-37cd9153314mr34360291fa.6.1764004406238; Mon, 24 Nov 2025 09:13:26 -0800 (PST)",
//         "mime-version": "1.0",
//         references:
//           "<CAM5PGGL3h0tBkwscfnJ-H_eDRp+jYLhGmSswdyE8m_WWRakvUw@mail.gmail.com>",
//         "in-reply-to":
//           "<CAM5PGGL3h0tBkwscfnJ-H_eDRp+jYLhGmSswdyE8m_WWRakvUw@mail.gmail.com>",
//         from: {
//           value: [
//             {
//               address: "sebruizufl@gmail.com",
//               name: "Sebastian Ruiz",
//             },
//           ],
//           html: '<span class="mp_address_group"><span class="mp_address_name">Sebastian Ruiz</span> &lt;<a href="mailto:sebruizufl@gmail.com" class="mp_address_email">sebruizufl@gmail.com</a>&gt;</span>',
//           text: '"Sebastian Ruiz" <sebruizufl@gmail.com>',
//         },
//         date: "2025-11-24T17:13:15.000Z",
//         "x-gm-features":
//           "AWmQ_bktcT09YPT7KiwINkQppTp688LfK56ZTVfe6mNabX8BnR4C5D5Sbu1bNqM",
//         "message-id":
//           "<CAM5PGGKYc8oDqGnaOzJ=q0E4Kswn+owg7272i+UaTW5FrKcsug@mail.gmail.com>",
//         subject: "Fwd: whomever it concerns",
//         to: {
//           value: [
//             {
//               address: "whoever@atmgrwthclip.com",
//               name: "",
//             },
//           ],
//           html: '<span class="mp_address_group"><a href="mailto:whoever@atmgrwthclip.com" class="mp_address_email">whoever@atmgrwthclip.com</a></span>',
//           text: "whoever@atmgrwthclip.com",
//         },
//         "content-type": {
//           value: "multipart/alternative",
//           params: {
//             boundary: "00000000000004265c06445a4826",
//           },
//         },
//       },
//     },
//     cleanedContent: {
//       html: '<div dir="ltr"><br><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <b class="gmail_sendername" dir="auto">Sebastian Ruiz</b> <span dir="auto">&lt;<a href="mailto:sebruizufl@gmail.com">sebruizufl@gmail.com</a>&gt;</span><br>Date: Mon, Nov 24, 2025 at 12:12 PM<br>Subject: whomever it concerns<br>To:  &lt;<a href="mailto:whomever@atmgrwthclip.com">whomever@atmgrwthclip.com</a>&gt;<br></div><br><br><div dir="ltr">ya know</div>\n</div></div>\n',
//       text: "---------- Forwarded message ---------\nFrom: Sebastian Ruiz <sebruizufl@gmail.com>\nDate: Mon, Nov 24, 2025 at 12:12 PM\nSubject: whomever it concerns\nTo: <whomever@atmgrwthclip.com>\n\n\nya know\n",
//       hasHtml: true,
//       hasText: true,
//       attachments: [],
//       headers: {
//         "return-path": {
//           value: [
//             {
//               address: "sebruizufl@gmail.com",
//               name: "",
//             },
//           ],
//           html: '<span class="mp_address_group"><a href="mailto:sebruizufl@gmail.com" class="mp_address_email">sebruizufl@gmail.com</a></span>',
//           text: "sebruizufl@gmail.com",
//         },
//         received: [
//           "from mail-lj1-f178.google.com (mail-lj1-f178.google.com [209.85.208.178]) by inbound-smtp.us-east-2.amazonaws.com with SMTP id eehuir1ejdq47mmk0bfhl19jj9ttrp7kp3pmuk81 for whoever@atmgrwthclip.com; Mon, 24 Nov 2025 17:13:28 +0000 (UTC)",
//           "by mail-lj1-f178.google.com with SMTP id 38308e7fff4ca-378e8d10494so56814001fa.2 for <whoever@atmgrwthclip.com>; Mon, 24 Nov 2025 09:13:28 -0800 (PST)",
//         ],
//         "received-spf":
//           "pass (spfCheck: domain of _spf.google.com designates 209.85.208.178 as permitted sender) client-ip=209.85.208.178; envelope-from=sebruizufl@gmail.com; helo=mail-lj1-f178.google.com;",
//         "authentication-results":
//           "amazonses.com; spf=pass (spfCheck: domain of _spf.google.com designates 209.85.208.178 as permitted sender) client-ip=209.85.208.178; envelope-from=sebruizufl@gmail.com; helo=mail-lj1-f178.google.com; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com;",
//         "x-ses-receipt":
//           "AEFBQUFBQUFBQUFGMjhiQlAxaVFhaFZhbzR4eFJkMEJxNVlLV09EenFCaE1jODBRK08rSXo3SHo0eWhIV0FGaDRKR2ttY2ZUQWxJdXJreDJXNk5wV05jTjU0MjV4aFV3cEFySHdzWHd5a0ZlVkRJQ0RCSFZMM0lkRGxyY0tVNzhjWVRvSVk5SW9NcUtFL2E4ZVNNalZlaGxLTGN2Y1FSakhiaFIyT2JTZU5tQnJaUzVtZnZOOWVQT2RucXFQaGkzbDBMLzcyNGVsVlAzdGZtVURpRVRnUjdwUEhtM2pPbXY3TC9oWkloZGNCbzFhSGNiZzUvc2hZVlVoMUxvU0lXWGpudkxCSHlLQVpUUnNZN2YyaUU3RDNiKzh6N04zZmhkMmpnTVpQTFV3b3Q4Z3pVTUNBNHJMSGc9PQ==",
//         "x-ses-dkim-signature":
//           "a=rsa-sha256; q=dns/txt; b=oqA4tCDC/hPLBR3ThsvCGQ4nTxfEZCtPclOhRY3SBcBaHAYxXYk/o6G4OiGlNFK1GQ+PUJw3ra3v/bE64M1nv/7W733bv53KGDQ9py67AcSUQ53Dtc6PrksNl23RLrP4mTIz56sa8XFW8s3Bk6b6/mYcNwS1OM0fjcQuF6y3mgQ=; c=relaxed/simple; s=ndjes4mrtuzus6qxu3frw3ubo3gpjndv; d=amazonses.com; t=1764004408; v=1; bh=a90BIE9J1SVlhXy3W696IzF2J5VR3p8W5EKmZtBWtjM=; h=From:To:Cc:Bcc:Subject:Date:Message-ID:MIME-Version:Content-Type:X-SES-RECEIPT;",
//         "dkim-signature": {
//           value: "v=1",
//           params: {
//             a: "rsa-sha256",
//             c: "relaxed/relaxed",
//             d: "gmail.com",
//             s: "20230601",
//             t: "1764004406",
//             x: "1764609206",
//             darn: "atmgrwthclip.com",
//             h: "to:subject:message-id:date:from:in-reply-to:references:mime-version :from:to:cc:subject:date:message-id:reply-to",
//             bh: "sMgKVfQJFfdgjKiM7KrpJYE4lexFgd06X7gmn87H/iY=",
//             b: "mgbOJkbC6p83fzxu9dFZbUxI4ZaIVQHPlVHTZM6oe9v81Pe4Dtj4lF26Oyb8B+trC9 oi3sRPgtPHSFOOaj8z5xiGmPE/VVdQvFv0enbY+oPf9/ekc00t/9CwEDEOYBPY+HtRtF e3MAXbXhpqWmP9kvcYg1F+PnMhFpuC5/lm9hdD5R3PlwHz90TCBgtE6extfWTfNQlE2n OnCWRyVOjJ4A5VLvhH7NXRYWOnFt7v3T5cUlUOBwBfcbSyTA/GvQM44NYNesILQRCRsJ eHGWpNeTAyxGB38143po99TAKhqPwTbE6FRqAaZOchbulrFRNQlKDlKCSBtuZO8lWPCD x7YQ==",
//           },
//         },
//         "x-google-dkim-signature":
//           "v=1; a=rsa-sha256; c=relaxed/relaxed; d=1e100.net; s=20230601; t=1764004406; x=1764609206; h=to:subject:message-id:date:from:in-reply-to:references:mime-version :x-gm-gg:x-gm-message-state:from:to:cc:subject:date:message-id :reply-to; bh=sMgKVfQJFfdgjKiM7KrpJYE4lexFgd06X7gmn87H/iY=; b=pUkSeoyS46wHpGWiYOoF0weHiKkQ27UOFSpqPxJMS5IJ/rgye19KaXlY4iOgndsNBK +WHgFP5ffo+XsjZerVOnpl823udhjFdxyWS+Hja7qrV6yR7GytGYPj3orAZR7O5GoAf3 OTnW/CCGWZwsMmIJy7AKAXc0yXOfDSnR7YjVI05p406/UiY4nf+aBZLgMpZcwT/+hh6V /lajbFU90xNToTvnFFstnkdqceB0HhD9XYQdASdGbMLgDbqanXgWy90woPh+a7eIqkFf Q0g61/8abqlmszseiR9yFzaIVYk0DBO98cISR/UQSYlw0pC3ALXOWtZ83teVs6S52iVU dBXQ==",
//         "x-gm-message-state":
//           "AOJu0YzYMYvNZcBbP/tgVAgjRVZ60ri2v/AhTcLBM+lkTkSC+ZGDQqKJ IhvsRXj3ysUMbipbbfUNgKP/hnI3nJo2tev3xTx/hOvVT9GWzlreykT85wlJqjVSINxTalpANNo NNmvFcLUjvgxVXShsrm45psyQnGhEg3AFf5Po",
//         "x-gm-gg":
//           "ASbGncsSvsD3Vc+r2W+rUnRYaIa3U3UkZrahOK1AsB6/IGfXcRMBp4rzxNG2T+FDlba HrBQJBAh9JrbitdNlrGDaadMGa97AKdStnmMnogHPv1ZLU+oEe6K0hc8SRuSTuQnyIlOLGeQPc/ puAFg7fooKquJY0D53cMUsKhlkVMRu0E7lcpFPW6HGAlqt5Xwswa+qXorEFzR75BNMUeCiWi2X5 XGnEF8ZE3lebQp4faCMUfCAkFT3BKeI2Pb03aXBBnVU0MDCjUkY2Iu+Q0VMR4nTvJyrqD0r9ptX hJcqb7bRHXp/ZKPxpeadF2xKUJ85srHvX3o/lAm+//qGHDTc00SyDSUxzq5S",
//         "x-google-smtp-source":
//           "AGHT+IFDG4+nUQuxLRs5kG51xmt613Qvt9MfMnMGbPjTO46hZvUqJXrnMn85pfwkyR044PZqC1BHF3BWR4qEkIec9OI=",
//         "x-received":
//           "by 2002:a2e:8a88:0:b0:37b:afdc:bb0d with SMTP id 38308e7fff4ca-37cd9153314mr34360291fa.6.1764004406238; Mon, 24 Nov 2025 09:13:26 -0800 (PST)",
//         "mime-version": "1.0",
//         references:
//           "<CAM5PGGL3h0tBkwscfnJ-H_eDRp+jYLhGmSswdyE8m_WWRakvUw@mail.gmail.com>",
//         "in-reply-to":
//           "<CAM5PGGL3h0tBkwscfnJ-H_eDRp+jYLhGmSswdyE8m_WWRakvUw@mail.gmail.com>",
//         from: {
//           value: [
//             {
//               address: "sebruizufl@gmail.com",
//               name: "Sebastian Ruiz",
//             },
//           ],
//           html: '<span class="mp_address_group"><span class="mp_address_name">Sebastian Ruiz</span> &lt;<a href="mailto:sebruizufl@gmail.com" class="mp_address_email">sebruizufl@gmail.com</a>&gt;</span>',
//           text: '"Sebastian Ruiz" <sebruizufl@gmail.com>',
//         },
//         date: "2025-11-24T17:13:15.000Z",
//         "x-gm-features":
//           "AWmQ_bktcT09YPT7KiwINkQppTp688LfK56ZTVfe6mNabX8BnR4C5D5Sbu1bNqM",
//         "message-id":
//           "<CAM5PGGKYc8oDqGnaOzJ=q0E4Kswn+owg7272i+UaTW5FrKcsug@mail.gmail.com>",
//         subject: "Fwd: whomever it concerns",
//         to: {
//           value: [
//             {
//               address: "whoever@atmgrwthclip.com",
//               name: "",
//             },
//           ],
//           html: '<span class="mp_address_group"><a href="mailto:whoever@atmgrwthclip.com" class="mp_address_email">whoever@atmgrwthclip.com</a></span>',
//           text: "whoever@atmgrwthclip.com",
//         },
//         "content-type": {
//           value: "multipart/alternative",
//           params: {
//             boundary: "00000000000004265c06445a4826",
//           },
//         },
//       },
//     },
//   },
//   endpoint: {
//     id: "vkzCltqiK51IGb0aN4A7B",
//     name: "Wh85b408bc409548d20f Webhook",
//     type: "webhook",
//   },
// };
