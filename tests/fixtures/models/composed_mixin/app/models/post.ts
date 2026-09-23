import { compose } from '@adonisjs/core/helpers'

import { PostSchema } from '#database/schema'
import { withSlug } from '#mixins/with_slug'

export default class Post extends compose(PostSchema, withSlug()) {
  static table = 'posts'
}
