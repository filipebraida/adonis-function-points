import Country from '#models/country'

/** The only writer of `countries`, and not the application maintaining it. */
export default class CountrySeeder {
  async run() {
    await Country.createMany([
      { code: 'BR', name: 'Brazil' },
      { code: 'PT', name: 'Portugal' },
    ])
  }
}
