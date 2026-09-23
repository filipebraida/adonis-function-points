import { PostSchema } from '#database/schema'

export default class Post extends PostSchema {
  static table = 'posts'
}
