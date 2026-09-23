/* eslint-disable prettier/prettier */
export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'books.index': {
    methods: ["GET","HEAD"]
    pattern: '/books'
    types: { body: {}; paramsTuple: []; params: {}; query: {}; response: unknown }
  }
  'books.store': {
    methods: ["POST"]
    pattern: '/books'
    types: {
      body: { authorId: number; title: string; isbn?: string }
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
    }
  }
  'books.destroy': {
    methods: ["DELETE"]
    pattern: '/books/:id'
    types: { body: {}; paramsTuple: [ParamValue]; params: { 'id': ParamValue }; query: {}; response: unknown }
  }
}
