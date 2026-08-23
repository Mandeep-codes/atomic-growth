import { OpenAI } from "openai";
import { env } from "./env";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

export const llmCall = async (imageUrl: string) => {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user", content: [
          { type: "text", text: PROMPT }, {
            type: "image_url", image_url: { url: imageUrl, detail: "low" },
          },],
      },],
  });
  return res;
};

export default llmCall;

const PROMPT = `
You are a helpful assistant that can analyze images and extract demographic information.
You will be given an image and you need to extract the demographic information from the image.
The demographic information should be in a JSON format like so:
{
  "countries": [
    { "country": "United Kingdom", "percentage": 7.6 },
    { "country": "Spain", "percentage": 7.3 },
    { "country": "Argentina", "percentage": 5.6 },
    { "country": "India", "percentage": 2.8 }
  ]
}

More technically, it should abide by the following Zod schema:

import { z } from "zod";

export const countrySchema = z.enum([
  "Afghanistan",
  "Albania",
  "Algeria",
  "Argentina",
  "Armenia",
  "Australia",
  "Austria",
  "Azerbaijan",
  "Bangladesh",
  "Belarus",
  "Belgium",
  "Bolivia",
  "Bosnia and Herzegovina",
  "Brazil",
  "Bulgaria",
  "Cambodia",
  "Cameroon",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Costa Rica",
  "Croatia",
  "Cuba",
  "Czech Republic",
  "Denmark",
  "Dominican Republic",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Estonia",
  "Ethiopia",
  "Finland",
  "France",
  "Georgia",
  "Germany",
  "Ghana",
  "Greece",
  "Guatemala",
  "Honduras",
  "Hong Kong",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Iran",
  "Iraq",
  "Ireland",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kuwait",
  "Latvia",
  "Lebanon",
  "Libya",
  "Lithuania",
  "Luxembourg",
  "Malaysia",
  "Mexico",
  "Moldova",
  "Mongolia",
  "Morocco",
  "Nepal",
  "Netherlands",
  "New Zealand",
  "Nigeria",
  "North Korea",
  "North Macedonia",
  "Norway",
  "Pakistan",
  "Panama",
  "Paraguay",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Qatar",
  "Romania",
  "Russia",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "South Africa",
  "South Korea",
  "Spain",
  "Sri Lanka",
  "Sweden",
  "Switzerland",
  "Syria",
  "Taiwan",
  "Tanzania",
  "Thailand",
  "Tunisia",
  "Turkey",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Venezuela",
  "Vietnam",
  "Yemen",
  "Zambia",
  "Zimbabwe",
  "Other", // Other countries not listed above
]);

export const demographicSchema = z.object({
  countries: z.array(
    z.object({ country: countrySchema, percentage: z.number().min(0).max(100) })
  ),
});

If the image does not seem to contain any demographic information, return an empty array for the countries array.

The output should be ONLY JSON, nothing else. I repeat, ONLY JSON that is valid according to the schema above.
`;
