# Sublabel Sales Hub

I want to build an app that fetch data from apple music using apple reporter. access token and vendor id should be secure in the server - back end-.

reports should be fetched on daily basis. - apple has specific time when reports are ready, system should have jobs to fetch data when report is ready ". Daily reports for the Americas are available by 5 am Pacific Time; Japan, Australia, and New Zealand by 5 am Japan Standard Time; and 5 am Central European Time for all other territories."

in lovable cloud a db will be created, which has sublabels, items and earnings.
items could be ringtones, singles or albums. 

sublabel will be added manually by admin. items under each sublabel will be added using csv file, which has item title and isrc-or upc- and maybe artist name. when a report get fetched from apple, after unzipping it, report is a txt file, which has item title , artist name, isrc and maybe upc - upc and isrc are the same- units sold, price,  currency - always convert to usd and maybe other fields, by matching items in db with ones in the report using isrc, sales should be added linked to items. 

the main purpose of the app is that admin can see the total sales and revenues of the company on daily, weekly, monthly and yearly basis, but the most important is that admin can see such data for each sublabel. also a sublabel can enter the system using an email and password given by the admin and see their sales and revenues. 

for exchange rates - connect it to any free platform with api - for converting all currencies to usd.

please search apple and apple reporter thoroughly

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b36ebb20-76d9-4bc1-8115-a46237bf3ca1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
