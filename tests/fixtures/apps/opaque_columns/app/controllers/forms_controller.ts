import Form from '#models/form'

export default class FormsController {
  async store({ request }: { request: { input: (key: string) => string } }) {
    await Form.create({ title: request.input('title') })
  }
}
