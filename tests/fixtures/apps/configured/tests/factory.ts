import Book from '#models/book'

// A write that exists only in the test: it must not become an application function.
export const makeBook = () => Book.create({ title: 'x', authorId: 1 })
