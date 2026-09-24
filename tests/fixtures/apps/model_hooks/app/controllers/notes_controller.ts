import Note from '#models/note'

export default class NotesController {
  /** The `@afterCreate` hook touches only the note's own row. */
  async store({ request }: { request: { input: (key: string) => string } }) {
    await Note.create({ body: request.input('body') })
  }
}
