import { compose } from '@adonisjs/core/helpers'

import { PostSchema } from '#database/schema'
import { withSlug } from '#mixins/with_slug'
import { withTracking } from '#mixins/with_tracking'

export default class Post extends compose(PostSchema, withSlug(), withTracking()) {
  static table = 'posts'
}
